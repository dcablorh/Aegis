//! AegisVault: stores each borrower's policy as a public commitment plus ciphertext (never the
//! plaintext thresholds) and only lets registered keepers and approved recipients touch rescues.

mod oracle;
mod rescue;
#[cfg(test)]
mod rescue_tests;

use aegis_types::{errors, EncryptedSolvencyPolicy, RescueLock};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

/// Upper bound on ciphertext size so a user cannot bloat contract storage.
const MAX_PAYLOAD_LEN: usize = 4096;
const MAX_ASSETS: usize = 16;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Policies,
    Keepers,
    Locks,
    Positions,
    Tickets,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AegisVault {
    pub owner_id: AccountId,
    /// Pinned `ed25519:` key of the price oracle enclave (used from M3 on).
    pub oracle_public_key: String,
    pub burrow_contract_id: AccountId,
    pub ref_exchange_id: AccountId,
    pub outlayer_contract_id: AccountId,
    pub intents_contract_id: AccountId,
    pub(crate) policies: LookupMap<AccountId, EncryptedSolvencyPolicy>,
    pub(crate) keepers: LookupSet<AccountId>,
    pub(crate) locks: LookupMap<AccountId, RescueLock>,
    /// borrower -> the sub-account that holds their Burrow loan and reserve tokens
    pub(crate) positions: LookupMap<AccountId, AccountId>,
    pub(crate) tickets: LookupMap<String, rescue::TicketRecord>,
    /// Ed25519 key (hex) the enclave signs decisions with. Empty = rescues disabled.
    pub enclave_public_key_hex: String,
    /// sha256 (hex) of the enclave wasm that decisions must be attested with. Empty = not enforced.
    pub expected_attestation_sha256: String,
    /// OutLayer project (`owner/name`) and secrets profile used by `request_execution`.
    pub outlayer_project_id: String,
    pub outlayer_secrets_profile: String,
    /// Account that owns the OutLayer secrets (not necessarily the vault owner).
    pub outlayer_secrets_account_id: String,
}

#[near]
impl AegisVault {
    #[init]
    pub fn new(
        owner_id: AccountId,
        oracle_public_key: String,
        burrow_contract_id: AccountId,
        ref_exchange_id: AccountId,
        outlayer_contract_id: AccountId,
        intents_contract_id: AccountId,
    ) -> Self {
        Self {
            owner_id,
            oracle_public_key,
            burrow_contract_id,
            ref_exchange_id,
            outlayer_contract_id,
            intents_contract_id,
            policies: LookupMap::new(StorageKey::Policies),
            keepers: LookupSet::new(StorageKey::Keepers),
            locks: LookupMap::new(StorageKey::Locks),
            positions: LookupMap::new(StorageKey::Positions),
            tickets: LookupMap::new(StorageKey::Tickets),
            enclave_public_key_hex: String::new(),
            expected_attestation_sha256: String::new(),
            outlayer_project_id: String::new(),
            outlayer_secrets_profile: String::new(),
            outlayer_secrets_account_id: String::new(),
        }
    }

    /// Called by the borrower. Stores only the SHA-256 commitment (64 hex chars) and the ciphertext
    /// that only the enclave can open (Invariant 1).
    pub fn register_policy(
        &mut self,
        policy_commitment_hash_hex: String,
        encrypted_payload_base64: String,
        allowed_origin_assets: Vec<String>,
        target_repay_asset: String,
    ) {
        let owner = env::predecessor_account_id();
        require!(
            self.lock_of(&owner) == RescueLock::Idle,
            errors::RESCUE_IN_FLIGHT
        );
        require!(
            !encrypted_payload_base64.is_empty() && encrypted_payload_base64.len() <= MAX_PAYLOAD_LEN,
            "ERR_BAD_PAYLOAD_SIZE"
        );
        require!(
            !allowed_origin_assets.is_empty() && allowed_origin_assets.len() <= MAX_ASSETS,
            "ERR_BAD_ASSET_LIST"
        );
        let hash: [u8; 32] = hex::decode(&policy_commitment_hash_hex)
            .ok()
            .and_then(|b| b.try_into().ok())
            .unwrap_or_else(|| env::panic_str("ERR_BAD_COMMITMENT"));

        self.policies.insert(
            owner.clone(),
            EncryptedSolvencyPolicy {
                owner_id: owner,
                policy_commitment_hash: hash,
                encrypted_payload_base64,
                allowed_origin_assets,
                target_repay_asset,
            },
        );
    }

    /// Borrower removes their policy. Blocked while a rescue is running.
    pub fn revoke_policy(&mut self) {
        let owner = env::predecessor_account_id();
        require!(
            self.lock_of(&owner) == RescueLock::Idle,
            errors::RESCUE_IN_FLIGHT
        );
        self.policies.remove(&owner);
    }

    pub fn get_policy(&self, account_id: AccountId) -> Option<EncryptedSolvencyPolicy> {
        self.policies.get(&account_id).cloned()
    }

    pub fn get_lock(&self, account_id: AccountId) -> RescueLock {
        self.lock_of(&account_id)
    }

    /// Contract owner decides who may trigger rescues. Keepers sign with a function-call key only.
    pub fn register_keeper(&mut self, keeper_id: AccountId) {
        self.assert_owner();
        self.keepers.insert(keeper_id);
    }

    pub fn remove_keeper(&mut self, keeper_id: AccountId) {
        self.assert_owner();
        self.keepers.remove(&keeper_id);
    }

    pub fn is_keeper(&self, account_id: AccountId) -> bool {
        self.keepers.contains(&account_id)
    }

    /// Borrower names the sub-account that holds their Burrow loan. Rescue funds may flow to and from it.
    pub fn set_position(&mut self, position_account_id: AccountId) {
        let owner = env::predecessor_account_id();
        require!(self.lock_of(&owner) == RescueLock::Idle, errors::RESCUE_IN_FLIGHT);
        self.positions.insert(owner, position_account_id);
    }

    pub fn get_position(&self, account_id: AccountId) -> Option<AccountId> {
        self.positions.get(&account_id).cloned()
    }

    /// Owner pins the enclave signing key and the wasm hash that decisions must carry.
    pub fn set_enclave(&mut self, public_key_hex: String, attestation_sha256: String) {
        self.assert_owner();
        let ok = hex::decode(&public_key_hex).is_ok_and(|b| b.len() == 32);
        require!(ok, "ERR_BAD_ENCLAVE_KEY");
        self.enclave_public_key_hex = public_key_hex;
        self.expected_attestation_sha256 = attestation_sha256;
    }

    pub fn set_outlayer_project(&mut self, project_id: String, secrets_profile: String, secrets_account_id: String) {
        self.assert_owner();
        self.outlayer_project_id = project_id;
        self.outlayer_secrets_profile = secrets_profile;
        self.outlayer_secrets_account_id = secrets_account_id;
    }

    /// Emergency valve: owner frees a lock that got stuck (for example OutLayer never answered).
    pub fn force_clear_lock(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.locks.remove(&account_id);
    }

    /// Read-only answer to "could this vault ever send this borrower's funds to `recipient`?".
    pub fn is_recipient_allowed(&self, account_id: AccountId, recipient: AccountId) -> bool {
        self.recipient_allowed(&account_id, &recipient)
    }
}

impl AegisVault {
    pub(crate) fn lock_of(&self, account_id: &AccountId) -> RescueLock {
        self.locks.get(account_id).cloned().unwrap_or(RescueLock::Idle)
    }

    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
    }

    pub(crate) fn assert_authorized_keeper(&self, caller: &AccountId) {
        require!(self.keepers.contains(caller), errors::UNAUTHORIZED_KEEPER);
    }

    /// Invariant 2: funds of `borrower` may only go to the borrower, Burrow, Ref or intents.near.
    fn recipient_allowed(&self, borrower: &AccountId, recipient: &AccountId) -> bool {
        recipient == borrower
            || self.positions.get(borrower) == Some(recipient)
            || recipient == &self.burrow_contract_id
            || recipient == &self.ref_exchange_id
            || recipient == &self.intents_contract_id
    }

    pub(crate) fn assert_recipient_allowlist(&self, borrower: &AccountId, recipient: &AccountId) {
        require!(
            self.recipient_allowed(borrower, recipient),
            errors::UNAUTHORIZED_RECIPIENT
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(id(who)).build());
    }

    fn vault() -> AegisVault {
        as_caller("admin.near");
        AegisVault::new(
            id("admin.near"),
            "ed25519:oracle".into(),
            id("contract.main.burrow.near"),
            id("v2.ref-finance.near"),
            id("outlayer.near"),
            id("intents.near"),
        )
    }

    fn register(v: &mut AegisVault, who: &str) {
        as_caller(who);
        v.register_policy("ab".repeat(32), "Y2lwaGVy".into(), vec!["nep141:base.omft.near".into()], "nep141:usdc".into());
    }

    #[test]
    fn registers_and_reads_policy() {
        let mut v = vault();
        register(&mut v, "alice.near");
        let p = v.get_policy(id("alice.near")).unwrap();
        assert_eq!(p.policy_commitment_hash, [0xab; 32]);
        assert_eq!(p.owner_id, id("alice.near"));
        assert!(v.get_policy(id("bob.near")).is_none());
    }

    #[test]
    fn stored_policy_has_no_plaintext_thresholds() {
        let mut v = vault();
        register(&mut v, "alice.near");
        let bytes = near_sdk::borsh::to_vec(&v.get_policy(id("alice.near")).unwrap()).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        for needle in ["hf_min", "hf_target", "max_slippage", "10800", "12500"] {
            assert!(!text.contains(needle), "{needle} leaked");
        }
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_COMMITMENT")]
    fn rejects_short_commitment() {
        let mut v = vault();
        as_caller("alice.near");
        v.register_policy("abcd".into(), "Y2lwaGVy".into(), vec!["a".into()], "b".into());
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_PAYLOAD_SIZE")]
    fn rejects_empty_ciphertext() {
        let mut v = vault();
        as_caller("alice.near");
        v.register_policy("ab".repeat(32), "".into(), vec!["a".into()], "b".into());
    }

    #[test]
    fn revoke_removes_policy() {
        let mut v = vault();
        register(&mut v, "alice.near");
        v.revoke_policy();
        assert!(v.get_policy(id("alice.near")).is_none());
    }

    #[test]
    #[should_panic(expected = "ERR_RESCUE_IN_FLIGHT")]
    fn cannot_revoke_during_rescue() {
        let mut v = vault();
        register(&mut v, "alice.near");
        v.locks.insert(id("alice.near"), RescueLock::InFlight { request_id: "r1".into() });
        v.revoke_policy();
    }

    #[test]
    fn only_owner_manages_keepers() {
        let mut v = vault();
        as_caller("admin.near");
        v.register_keeper(id("keeper.near"));
        assert!(v.is_keeper(id("keeper.near")));
        v.assert_authorized_keeper(&id("keeper.near"));
        v.remove_keeper(id("keeper.near"));
        assert!(!v.is_keeper(id("keeper.near")));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn stranger_cannot_add_keeper() {
        let mut v = vault();
        as_caller("evil.near");
        v.register_keeper(id("evil.near"));
    }

    #[test]
    #[should_panic(expected = "ERR_UNAUTHORIZED_KEEPER")]
    fn unregistered_keeper_rejected() {
        let v = vault();
        v.assert_authorized_keeper(&id("evil.near"));
    }

    #[test]
    fn allowlist_accepts_only_approved_recipients() {
        let v = vault();
        let alice = id("alice.near");
        for ok in ["alice.near", "contract.main.burrow.near", "v2.ref-finance.near", "intents.near"] {
            v.assert_recipient_allowlist(&alice, &id(ok));
        }
        assert!(!v.is_recipient_allowed(alice.clone(), id("evil.near")));
        // another borrower's account is not an allowed destination for alice's funds
        assert!(!v.is_recipient_allowed(alice, id("bob.near")));
    }

    #[test]
    #[should_panic(expected = "ERR_UNAUTHORIZED_RECIPIENT")]
    fn allowlist_blocks_evil_recipient() {
        let v = vault();
        v.assert_recipient_allowlist(&id("alice.near"), &id("evil.near"));
    }
}
