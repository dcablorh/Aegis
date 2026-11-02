//! One of these lives on each borrower's position sub-account (e.g. `alice.aegis-vault.testnet`).
//! That sub-account is the account that holds the Burrow loan, so Burrow repayments sent from it
//! reach the borrower's own debt. It does exactly two things for the vault: send reserve tokens to a
//! swap deposit address, and repay Burrow. It can never send tokens anywhere else on the vault's say-so.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, serde_json, AccountId, Gas, NearToken, Promise, PanicOnDefault};

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const SEND_GAS: Gas = Gas::from_tgas(30);
const REPAY_GAS: Gas = Gas::from_tgas(150);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AegisPosition {
    pub owner_id: AccountId,
    pub vault_id: AccountId,
    pub burrow_id: AccountId,
}

#[near]
impl AegisPosition {
    #[init]
    pub fn new(owner_id: AccountId, vault_id: AccountId, burrow_id: AccountId) -> Self {
        Self { owner_id, vault_id, burrow_id }
    }

    /// Vault only. Sends reserve tokens to a swap deposit address that the vault verified.
    pub fn send_reserve(&mut self, token_id: AccountId, amount: U128, deposit_address: AccountId) -> Promise {
        self.assert_vault();
        Promise::new(token_id).function_call(
            "ft_transfer",
            serde_json::json!({ "receiver_id": deposit_address, "amount": amount, "memo": "aegis-rescue" })
                .to_string()
                .into_bytes(),
            ONE_YOCTO,
            SEND_GAS,
        )
    }

    /// Vault only. Repays this account's Burrow debt with tokens it holds. The receiver is fixed to Burrow.
    pub fn repay(&mut self, token_id: AccountId, amount: U128) -> Promise {
        self.assert_vault();
        let msg = serde_json::json!({
            "Execute": { "actions": [ { "Repay": { "token_id": token_id, "amount": amount } } ] }
        })
        .to_string();
        Promise::new(token_id).function_call(
            "ft_transfer_call",
            serde_json::json!({ "receiver_id": self.burrow_id, "amount": amount, "msg": msg })
                .to_string()
                .into_bytes(),
            ONE_YOCTO,
            REPAY_GAS,
        )
    }

    /// Owner only. The borrower can always take their own tokens back out.
    pub fn withdraw(&mut self, token_id: AccountId, amount: U128, to: AccountId) -> Promise {
        require!(env::predecessor_account_id() == self.owner_id, "ERR_NOT_OWNER");
        Promise::new(token_id).function_call(
            "ft_transfer",
            serde_json::json!({ "receiver_id": to, "amount": amount, "memo": "aegis-withdraw" })
                .to_string()
                .into_bytes(),
            ONE_YOCTO,
            SEND_GAS,
        )
    }
}

impl AegisPosition {
    fn assert_vault(&self) {
        require!(env::predecessor_account_id() == self.vault_id, "ERR_NOT_VAULT");
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

    fn pos() -> AegisPosition {
        AegisPosition::new(id("alice.near"), id("vault.near"), id("burrow.near"))
    }

    fn as_caller(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(id(who)).build());
    }

    #[test]
    fn vault_can_repay() {
        let mut p = pos();
        as_caller("vault.near");
        let _ = p.repay(id("usdc.near"), U128(345_600_000));
    }

    #[test]
    fn vault_can_send_reserve() {
        let mut p = pos();
        as_caller("vault.near");
        let _ = p.send_reserve(id("usdc.near"), U128(5), id("deposit.near"));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_VAULT")]
    fn stranger_cannot_repay() {
        let mut p = pos();
        as_caller("evil.near");
        let _ = p.repay(id("usdc.near"), U128(1));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_VAULT")]
    fn stranger_cannot_send_reserve() {
        let mut p = pos();
        as_caller("evil.near");
        let _ = p.send_reserve(id("usdc.near"), U128(1), id("evil.near"));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_VAULT")]
    fn the_owner_is_not_the_vault() {
        let mut p = pos();
        as_caller("alice.near");
        let _ = p.repay(id("usdc.near"), U128(1));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn only_owner_withdraws() {
        let mut p = pos();
        as_caller("vault.near");
        let _ = p.withdraw(id("usdc.near"), U128(1), id("vault.near"));
    }

    #[test]
    fn owner_can_withdraw() {
        let mut p = pos();
        as_caller("alice.near");
        let _ = p.withdraw(id("usdc.near"), U128(1), id("alice.near"));
    }
}
