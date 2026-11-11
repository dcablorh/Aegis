//! The rescue lifecycle: trigger -> enclave decision -> approved ticket -> execute -> final status.
//!
//! Money only ever moves through the borrower's position sub-account, and only on the strength of a
//! decision the pinned enclave key signed (Invariants 2 and 3). Every terminal state frees the lock (Invariant 5).

use aegis_types::{
    errors, ApprovedRescueTicket, EnclaveExecutionInput, EnclaveRescueDecision, IntentLifecycleState,
    OraclePricePayload, PositionSnapshot, RescueAction, RescueLock,
};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, serde_json, AccountId, Gas, NearToken, Promise, PromiseError,
};

use crate::oracle::token_account_of;
use crate::{AegisVault, AegisVaultExt};

/// Explicit OutLayer limits. Empty limits (`{}`) made the worker fail on testnet; the enclave uses about 10 million instructions.
const ENCLAVE_MAX_INSTRUCTIONS: u64 = 1_000_000_000;
const ENCLAVE_MAX_MEMORY_MB: u32 = 128;
const ENCLAVE_MAX_SECONDS: u64 = 10;
/// A ticket older than this is not executed: the 1Click quote it carries has expired and the price has moved.
const MAX_TICKET_AGE_NS: u64 = 5 * 60 * 1_000_000_000;
const MAX_PRICE_HISTORY: usize = 16;
const REQUEST_GAS: Gas = Gas::from_tgas(100);
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const POSITION_SEND_GAS: Gas = Gas::from_tgas(60);
const POSITION_REPAY_GAS: Gas = Gas::from_tgas(180);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TicketRecord {
    pub ticket: ApprovedRescueTicket,
    pub state: IntentLifecycleState,
    pub origin_token: AccountId,
    pub repay_token: AccountId,
    pub deposit_account: AccountId,
}

fn event(kind: &str, detail: &str) {
    env::log_str(&format!("AEGIS_EVENT:{kind}:{detail}"));
}

#[near]
impl AegisVault {
    /// Keeper only. Verifies the price feed, locks the borrower, and asks OutLayer to run the enclave.
    #[payable]
    pub fn trigger_solvency_check(
        &mut self,
        account_id: AccountId,
        position: PositionSnapshot,
        price: OraclePricePayload,
        price_history: Vec<OraclePricePayload>,
    ) -> Promise {
        self.assert_authorized_keeper(&env::predecessor_account_id());
        require!(
            !self.outlayer_project_id.is_empty() && !self.outlayer_secrets_account_id.is_empty(),
            "ERR_OUTLAYER_NOT_CONFIGURED"
        );
        require!(!self.enclave_public_key_hex.is_empty(), "ERR_ENCLAVE_NOT_CONFIGURED");
        let policy = self.policies.get(&account_id).cloned().unwrap_or_else(|| env::panic_str("ERR_NO_POLICY"));
        require!(self.lock_of(&account_id) == RescueLock::Idle, errors::RESCUE_IN_FLIGHT);
        self.assert_valid_oracle_payload(&price);
        require!(price_history.len() <= MAX_PRICE_HISTORY, "ERR_PRICE_HISTORY_TOO_LONG");
        for old in &price_history {
            // history is allowed to be older than 60s, but must still be signed by the pinned key
            self.assert_signed_only(old);
        }

        let mut seed = env::random_seed();
        seed.extend_from_slice(account_id.as_bytes());
        let request_id = hex::encode(&env::sha256(&seed)[..16]);
        self.locks.insert(account_id.clone(), RescueLock::InFlight { request_id: request_id.clone() });

        let input = EnclaveExecutionInput {
            request_id: request_id.clone(),
            account_id: account_id.clone(),
            policy,
            position,
            price,
            price_history,
            now_unix_s: env::block_timestamp() / 1_000_000_000,
        };
        let args = serde_json::json!({
            "source": { "Project": { "project_id": self.outlayer_project_id, "version_key": null } },
            "resource_limits": { "max_instructions": ENCLAVE_MAX_INSTRUCTIONS, "max_memory_mb": ENCLAVE_MAX_MEMORY_MB, "max_execution_seconds": ENCLAVE_MAX_SECONDS },
            "input_data": serde_json::to_string(&input).unwrap(),
            "secrets_ref": { "profile": self.outlayer_secrets_profile, "account_id": self.outlayer_secrets_account_id },
            "response_format": "Json",
        });
        Promise::new(self.outlayer_contract_id.clone())
            .function_call("request_execution", args.to_string().into_bytes(), env::attached_deposit(), REQUEST_GAS)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_enclave_decision(account_id, request_id),
            )
    }

    /// Private callback: OutLayer's answer arrives here as the result of the `request_execution` promise.
    /// Never panics once the lock is known to be ours, so a bad answer cannot leave a stuck lock.
    #[private]
    pub fn on_enclave_decision(
        &mut self,
        account_id: AccountId,
        request_id: String,
        #[callback_result] result: Result<serde_json::Value, PromiseError>,
    ) {
        self.process_decision(account_id, request_id, result.ok());
    }

    /// Keeper only. Sends the borrower's reserve to the attested swap deposit address.
    pub fn execute_approved_rescue(&mut self, ticket_id: String) -> Promise {
        self.assert_authorized_keeper(&env::predecessor_account_id());
        let mut rec = self.tickets.get(&ticket_id).cloned().unwrap_or_else(|| env::panic_str("ERR_NO_TICKET"));
        require!(rec.state == IntentLifecycleState::PendingDeposit, "ERR_TICKET_ALREADY_EXECUTED");
        let d = &rec.ticket.decision;
        let q = d.oneclick_quote.as_ref().unwrap_or_else(|| env::panic_str("ERR_NO_QUOTE"));
        require!(!q.dry, "ERR_DRY_RUN_QUOTE_CANNOT_EXECUTE");
        require!(
            env::block_timestamp().saturating_sub(rec.ticket.created_at_ns) <= MAX_TICKET_AGE_NS,
            "ERR_TICKET_EXPIRED"
        );
        self.assert_attested_recipient(&d.account_id, &rec.deposit_account);
        let position = self.positions.get(&d.account_id).cloned().unwrap_or_else(|| env::panic_str("ERR_NO_POSITION"));
        let amount_in: u128 = q.amount_in.parse().unwrap_or_else(|_| env::panic_str("ERR_BAD_AMOUNT"));

        rec.state = IntentLifecycleState::Processing;
        let call = Promise::new(position).function_call(
            "send_reserve",
            serde_json::json!({
                "token_id": rec.origin_token,
                "amount": U128(amount_in),
                "deposit_address": rec.deposit_account,
            })
            .to_string()
            .into_bytes(),
            NearToken::from_yoctonear(0),
            POSITION_SEND_GAS,
        );
        self.tickets.insert(ticket_id, rec);
        call
    }

    /// Keeper only. Reports how the 1Click swap ended. Success repays Burrow; Refunded/Failed free the lock.
    pub fn report_intent_status(&mut self, ticket_id: String, status: IntentLifecycleState) -> Option<Promise> {
        self.assert_authorized_keeper(&env::predecessor_account_id());
        let mut rec = self.tickets.get(&ticket_id).cloned().unwrap_or_else(|| env::panic_str("ERR_NO_TICKET"));
        require!(rec.state.can_transition_to(status), "ERR_BAD_STATE_TRANSITION");
        rec.state = status;
        let account = rec.ticket.decision.account_id.clone();
        let result = match status {
            IntentLifecycleState::Success => {
                // The ticket is only marked settled, and the lock only freed, once Burrow confirms the repay
                // (see `on_repay_result`). Until then it stays Processing so the keeper can retry.
                let position = self.positions.get(&account).cloned().unwrap_or_else(|| env::panic_str("ERR_NO_POSITION"));
                let amount: u128 = rec.ticket.decision.repay_amount_raw.parse().unwrap_or_else(|_| env::panic_str("ERR_BAD_AMOUNT"));
                return Some(
                    Promise::new(position)
                        .function_call(
                            "repay",
                            serde_json::json!({ "token_id": rec.repay_token, "amount": U128(amount) }).to_string().into_bytes(),
                            NearToken::from_yoctonear(0),
                            POSITION_REPAY_GAS,
                        )
                        .then(
                            Self::ext(env::current_account_id())
                                .with_static_gas(CALLBACK_GAS)
                                .on_repay_result(ticket_id),
                        ),
                );
            }
            IntentLifecycleState::Refunded | IntentLifecycleState::Failed => {
                self.handle_intent_fallback(&account, &ticket_id, status);
                None
            }
            _ => None,
        };
        self.tickets.insert(ticket_id, rec);
        result
    }

    /// Private callback after the position's `repay`. `ft_transfer_call` resolves to the amount Burrow actually used.
    #[private]
    pub fn on_repay_result(&mut self, ticket_id: String, #[callback_result] result: Result<U128, PromiseError>) {
        self.finish_repay(ticket_id, result.ok().map(|u| u.0));
    }

    pub fn get_ticket(&self, ticket_id: String) -> Option<TicketRecord> {
        self.tickets.get(&ticket_id).cloned()
    }
}

impl AegisVault {
    /// Settles the ticket only when Burrow reports that some debt was repaid; otherwise it stays Processing and locked.
    pub fn finish_repay(&mut self, ticket_id: String, used: Option<u128>) {
        let Some(mut rec) = self.tickets.get(&ticket_id).cloned() else { return };
        if rec.state != IntentLifecycleState::Processing {
            return;
        }
        if used.is_none_or(|u| u == 0) {
            event("RESCUE_REPAY_FAILED", &ticket_id);
            return;
        }
        rec.state = IntentLifecycleState::Success;
        let account = rec.ticket.decision.account_id.clone();
        self.tickets.insert(ticket_id.clone(), rec);
        self.locks.remove(&account);
        event("RESCUE_SETTLED", &ticket_id);
    }

    /// Signature-only check, used for older history entries.
    pub(crate) fn assert_signed_only(&self, feed: &OraclePricePayload) {
        use base64::Engine;
        let key = near_sdk::bs58::decode(self.oracle_public_key.strip_prefix("ed25519:").unwrap_or(&self.oracle_public_key))
            .into_vec()
            .ok()
            .and_then(|b| <[u8; 32]>::try_from(b).ok())
            .unwrap_or_else(|| env::panic_str("ERR_BAD_PINNED_ORACLE_KEY"));
        let sig = base64::engine::general_purpose::STANDARD
            .decode(&feed.signature_b64)
            .ok()
            .and_then(|b| <[u8; 64]>::try_from(b).ok())
            .unwrap_or_else(|| env::panic_str(errors::BAD_ORACLE_SIGNATURE));
        if !env::ed25519_verify(&sig, feed.payload.as_bytes(), &key) {
            env::panic_str(errors::BAD_ORACLE_SIGNATURE);
        }
    }

    /// Invariant 2(d): the only non-fixed recipient allowed is the deposit address inside the borrower's in-flight ticket.
    pub(crate) fn assert_attested_recipient(&self, borrower: &AccountId, recipient: &AccountId) {
        require!(self.ticket_has_deposit(borrower, recipient), errors::UNAUTHORIZED_RECIPIENT);
    }

    fn ticket_has_deposit(&self, borrower: &AccountId, recipient: &AccountId) -> bool {
        match self.locks.get(borrower) {
            Some(RescueLock::InFlight { request_id }) => self
                .tickets
                .get(request_id)
                .is_some_and(|t| &t.deposit_account == recipient && &t.ticket.decision.account_id == borrower),
            _ => false,
        }
    }

    /// Frees the lock and records why. Used for every non-executing outcome.
    fn release(&mut self, account_id: &AccountId, why: &str) {
        self.locks.remove(account_id);
        event("RESCUE_NOT_EXECUTED", why);
    }

    pub(crate) fn handle_intent_fallback(&mut self, account_id: &AccountId, ticket_id: &str, status: IntentLifecycleState) {
        self.locks.remove(account_id);
        // The reserve was refunded to the position account by 1Click, or never left it. Local swap (Ref) is a manual follow-up.
        event("FALLBACK_NEEDED", &format!("{ticket_id}:{status:?}"));
    }

    /// Core of the callback, separate so it can be unit-tested without a promise result.
    pub(crate) fn process_decision(
        &mut self,
        account_id: AccountId,
        request_id: String,
        answer: Option<serde_json::Value>,
    ) {
        require!(
            self.lock_of(&account_id) == RescueLock::InFlight { request_id: request_id.clone() },
            errors::NO_LOCK_FOR_REQUEST
        );
        let Some(answer) = answer else { return self.release(&account_id, "enclave_call_failed") };
        let parsed = match &answer {
            serde_json::Value::String(s) => serde_json::from_str::<EnclaveRescueDecision>(s),
            other => serde_json::from_value::<EnclaveRescueDecision>(other.clone()),
        };
        let Ok(d) = parsed else { return self.release(&account_id, "unreadable_decision") };

        if d.request_id != request_id || d.account_id != account_id {
            return self.release(&account_id, "decision_for_other_request");
        }
        if !self.enclave_signature_ok(&d) {
            return self.release(&account_id, errors::BAD_ENCLAVE_SIGNATURE);
        }
        if !self.expected_attestation_sha256.is_empty() && d.attestation_sha256 != self.expected_attestation_sha256 {
            return self.release(&account_id, "wrong_attestation");
        }
        if d.action != RescueAction::RepayDebt {
            return self.release(&account_id, &format!("action_{:?}", d.action));
        }
        let (Some(q), Some(policy)) = (d.oneclick_quote.as_ref(), self.policies.get(&account_id).cloned()) else {
            return self.release(&account_id, "missing_quote_or_policy");
        };
        if q.dry {
            return self.release(&account_id, "dry_run_quote_verified");
        }
        let amounts_ok = d.repay_amount_raw.parse::<u128>().is_ok_and(|n| n > 0) && q.amount_in.parse::<u128>().is_ok_and(|n| n > 0);
        let origin = policy.allowed_origin_assets.first().and_then(|a| token_account_of(a));
        let repay_token = token_account_of(&policy.target_repay_asset);
        let deposit = q.deposit_address.parse::<AccountId>().ok();
        let (true, Some(origin_token), Some(repay_token), Some(deposit_account)) = (amounts_ok, origin, repay_token, deposit) else {
            return self.release(&account_id, "bad_ticket_fields");
        };
        if !self.positions.contains_key(&account_id) {
            return self.release(&account_id, "no_position");
        }
        self.tickets.insert(
            request_id.clone(),
            TicketRecord {
                ticket: ApprovedRescueTicket { ticket_id: request_id.clone(), decision: d, created_at_ns: env::block_timestamp() },
                state: IntentLifecycleState::PendingDeposit,
                origin_token,
                repay_token,
                deposit_account,
            },
        );
        event("RESCUE_APPROVED", &request_id);
    }

    fn enclave_signature_ok(&self, d: &EnclaveRescueDecision) -> bool {
        let key = hex::decode(&self.enclave_public_key_hex).ok().and_then(|b| <[u8; 32]>::try_from(b).ok());
        let sig = hex::decode(&d.enclave_signature_hex).ok().and_then(|b| <[u8; 64]>::try_from(b).ok());
        match (key, sig) {
            (Some(k), Some(s)) => env::ed25519_verify(&s, &d.signing_message(), &k),
            _ => false,
        }
    }
}
