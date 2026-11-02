//! Shared domain types for AegisMargin. Mirrored field-for-field by
//! `packages/shared-types` (TypeScript). Change both together.
//! JSON wire format follows the frozen schema in NEAR_HACKATHON_PROJECT_CONTEXT.md.

use borsh::{BorshDeserialize, BorshSerialize};
pub use near_account_id::AccountId;
use serde::{Deserialize, Serialize};

/// 32-byte hash serialized as 64 lowercase hex chars in JSON.
mod hex32 {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&hex::encode(v))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s = String::deserialize(d)?;
        let bytes = hex::decode(&s).map_err(serde::de::Error::custom)?;
        bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("expected 32 bytes (64 hex chars)"))
    }
}

/// Public on-chain record. Only a commitment and ciphertext: no plaintext thresholds (Invariant 1).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct EncryptedSolvencyPolicy {
    pub owner_id: AccountId,
    #[serde(with = "hex32")]
    pub policy_commitment_hash: [u8; 32],
    pub encrypted_payload_base64: String,
    pub allowed_origin_assets: Vec<String>,
    pub target_repay_asset: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RescueAction {
    None,
    RepayDebt,
    AddCollateral,
    LocalFallbackSwap,
}

/// Summary of a NEAR Intents 1Click quote. `dry == true` means no deposit address is live.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OneClickQuotePayload {
    pub quote_id: String,
    pub dry: bool,
    pub deposit_address: String,
    pub amount_in: String,
    pub amount_out: String,
    pub solver_spread_bps: u32,
    pub liquidation_penalty_saved_bps: u32,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct EnclaveRescueDecision {
    pub request_id: String,
    pub account_id: AccountId,
    pub observed_hf_bps: u32,
    pub trigger_hf_bps: u32,
    pub target_hf_bps: u32,
    pub action: RescueAction,
    pub repay_amount_raw: String,
    pub oneclick_quote: Option<OneClickQuotePayload>,
    pub enclave_signature_hex: String,
    pub attestation_sha256: String,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IntentLifecycleState {
    PendingDeposit,
    Processing,
    Success,
    Refunded,
    Failed,
}

impl IntentLifecycleState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Success | Self::Refunded | Self::Failed)
    }

    /// Invariant 5: PENDING_DEPOSIT -> PROCESSING -> (SUCCESS | REFUNDED | FAILED).
    /// A quote may also go PENDING_DEPOSIT -> REFUNDED/FAILED (deposit never arrived / expired).
    pub fn can_transition_to(self, next: Self) -> bool {
        use IntentLifecycleState::*;
        matches!(
            (self, next),
            (PendingDeposit, Processing)
                | (PendingDeposit, Refunded)
                | (PendingDeposit, Failed)
                | (Processing, Success)
                | (Processing, Refunded)
                | (Processing, Failed)
        )
    }
}

/// Error strings shared by the vault and its tests/UI.
pub mod errors {
    pub const UNAUTHORIZED_RECIPIENT: &str = "ERR_UNAUTHORIZED_RECIPIENT";
    pub const UNAUTHORIZED_KEEPER: &str = "ERR_UNAUTHORIZED_KEEPER";
    pub const RESCUE_IN_FLIGHT: &str = "ERR_RESCUE_IN_FLIGHT";
    pub const NO_LOCK_FOR_REQUEST: &str = "ERR_NO_LOCK_FOR_REQUEST";
    pub const STALE_ORACLE: &str = "ERR_STALE_ORACLE";
    pub const BAD_ORACLE_SIGNATURE: &str = "ERR_BAD_ORACLE_SIGNATURE";
    pub const BAD_ENCLAVE_SIGNATURE: &str = "ERR_BAD_ENCLAVE_SIGNATURE";
}

/// Invariant 4: maximum oracle age, in nanoseconds.
pub const MAX_ORACLE_AGE_NS: u64 = 60_000_000_000;

/// Borrower policy in the clear. Exists only client-side and inside the enclave; never on-chain (Invariant 1).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PolicyPlaintext {
    pub hf_min_bps: u32,
    pub hf_target_bps: u32,
    pub max_slippage_bps: u32,
    /// Random blinding value, hex. Prevents brute-forcing the small threshold space from the commitment.
    pub salt_hex: String,
}

impl PolicyPlaintext {
    /// `sha256("aegis-policy-v1" || hf_min || hf_target || max_slip (u32 BE each) || salt bytes)`.
    pub fn commitment_hash(&self) -> Result<[u8; 32], hex::FromHexError> {
        use sha2::{Digest, Sha256};
        let salt = hex::decode(&self.salt_hex)?;
        let mut h = Sha256::new();
        h.update(b"aegis-policy-v1");
        h.update(self.hf_min_bps.to_be_bytes());
        h.update(self.hf_target_bps.to_be_bytes());
        h.update(self.max_slippage_bps.to_be_bytes());
        h.update(&salt);
        Ok(h.finalize().into())
    }
}

/// Signed price feed as emitted by `price-oracle.near` (docs: out-layer/oracle-example).
/// `signature_b64` is Ed25519 over the raw bytes of `payload`.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OraclePricePayload {
    pub payload: String,
    pub signature_b64: String,
    /// `ed25519:<base58>` as returned by the oracle; must equal the key pinned in the vault.
    pub public_key: String,
}

/// One leg of a Burrow position, as supplied to the enclave by the keeper.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PositionAsset {
    pub token_id: String,
    pub amount_raw: String,
    pub decimals: u8,
    /// Collateral weight (volatility ratio) or borrow weight, in bps (10000 = 1.0).
    pub weight_bps: u32,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PositionSnapshot {
    pub collateral: Vec<PositionAsset>,
    pub borrowed: Vec<PositionAsset>,
}

/// stdin payload of the enclave (`EnclaveExecutionInput` JSON).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct EnclaveExecutionInput {
    pub request_id: String,
    pub account_id: AccountId,
    pub policy: EncryptedSolvencyPolicy,
    pub position: PositionSnapshot,
    pub price: OraclePricePayload,
    /// Unix seconds at request time (from the contract's block timestamp).
    pub now_unix_s: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RescueLock {
    Idle,
    InFlight { request_id: String },
}

/// Stored by the vault after an enclave decision is verified; executed in a later, separate call (gas budget).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ApprovedRescueTicket {
    pub ticket_id: String,
    pub decision: EnclaveRescueDecision,
    pub created_at_ns: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commitment_hash_binds_every_field() {
        let p = PolicyPlaintext { hf_min_bps: 10800, hf_target_bps: 12500, max_slippage_bps: 35, salt_hex: "00ff".into() };
        let h = p.commitment_hash().unwrap();
        assert_eq!(h, p.clone().commitment_hash().unwrap());
        for q in [
            PolicyPlaintext { hf_min_bps: 10801, ..p.clone() },
            PolicyPlaintext { hf_target_bps: 12501, ..p.clone() },
            PolicyPlaintext { max_slippage_bps: 36, ..p.clone() },
            PolicyPlaintext { salt_hex: "00fe".into(), ..p.clone() },
        ] {
            assert_ne!(h, q.commitment_hash().unwrap());
        }
        assert!(PolicyPlaintext { salt_hex: "zz".into(), ..p }.commitment_hash().is_err());
    }

    #[test]
    fn lock_and_ticket_roundtrip() {
        let l = RescueLock::InFlight { request_id: "r1".into() };
        assert_eq!(l, borsh::from_slice::<RescueLock>(&borsh::to_vec(&l).unwrap()).unwrap());
        assert_eq!(l, serde_json::from_str::<RescueLock>(&serde_json::to_string(&l).unwrap()).unwrap());
    }

    fn decision() -> EnclaveRescueDecision {
        EnclaveRescueDecision {
            request_id: "0f8fad5b-d9cb-469f-a165-70867728950e".into(),
            account_id: "alice.near".parse().unwrap(),
            observed_hf_bps: 10700,
            trigger_hf_bps: 10800,
            target_hf_bps: 12500,
            action: RescueAction::RepayDebt,
            repay_amount_raw: "345600000".into(),
            oneclick_quote: Some(OneClickQuotePayload {
                quote_id: "q1".into(),
                dry: true,
                deposit_address: "deposit_addr_or_dry_run".into(),
                amount_in: "345950000".into(),
                amount_out: "345600000".into(),
                solver_spread_bps: 10,
                liquidation_penalty_saved_bps: 600,
            }),
            enclave_signature_hex: "ab".repeat(64),
            attestation_sha256: "cd".repeat(32),
        }
    }

    #[test]
    fn decision_roundtrips_borsh_and_json() {
        let d = decision();
        let b = borsh::to_vec(&d).unwrap();
        assert_eq!(d, borsh::from_slice::<EnclaveRescueDecision>(&b).unwrap());
        let j = serde_json::to_string(&d).unwrap();
        assert_eq!(d, serde_json::from_str::<EnclaveRescueDecision>(&j).unwrap());
        assert!(j.contains("\"action\":\"REPAY_DEBT\""));
    }

    #[test]
    fn policy_hash_is_hex_in_json_and_roundtrips() {
        let p = EncryptedSolvencyPolicy {
            owner_id: "alice.near".parse().unwrap(),
            policy_commitment_hash: [0xab; 32],
            encrypted_payload_base64: "Y2lwaGVy".into(),
            allowed_origin_assets: vec!["nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near".into()],
            target_repay_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1".into(),
        };
        let j = serde_json::to_string(&p).unwrap();
        assert!(j.contains(&"ab".repeat(32)));
        assert_eq!(p, serde_json::from_str::<EncryptedSolvencyPolicy>(&j).unwrap());
        assert_eq!(p, borsh::from_slice::<EncryptedSolvencyPolicy>(&borsh::to_vec(&p).unwrap()).unwrap());
    }

    #[test]
    fn rejects_short_hash() {
        let j = r#"{"owner_id":"a.near","policy_commitment_hash":"abcd","encrypted_payload_base64":"","allowed_origin_assets":[],"target_repay_asset":""}"#;
        assert!(serde_json::from_str::<EncryptedSolvencyPolicy>(j).is_err());
    }

    #[test]
    fn lifecycle_state_machine() {
        use IntentLifecycleState::*;
        assert!(PendingDeposit.can_transition_to(Processing));
        assert!(Processing.can_transition_to(Success));
        assert!(!Success.can_transition_to(Processing));
        assert!(!PendingDeposit.can_transition_to(Success));
        assert!(Refunded.is_terminal() && Failed.is_terminal() && !Processing.is_terminal());
        assert_eq!(serde_json::to_string(&PendingDeposit).unwrap(), "\"PENDING_DEPOSIT\"");
    }
}
