//! Unit tests for the rescue lifecycle, the oracle check and the attack scenarios (Track 06).

use crate::AegisVault;
use aegis_types::{
    EnclaveRescueDecision, IntentLifecycleState, OneClickQuotePayload, OraclePricePayload, PositionSnapshot,
    RescueAction, RescueLock,
};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{serde_json, testing_env, AccountId};

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn as_caller(who: &str, ts_s: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(id(who))
        .current_account_id(id("vault.near"))
        .block_timestamp(ts_s * 1_000_000_000)
        .build());
}

fn enclave_key() -> SigningKey {
    SigningKey::from_bytes(&[8u8; 32])
}

fn oracle_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn feed(key: &SigningKey, publish_time: u64) -> OraclePricePayload {
    let payload = format!(r#"{{"wrap.near":{{"price":"428000000","expo":-8,"publish_time":{publish_time}}}}}"#);
    OraclePricePayload {
        signature_b64: base64::engine::general_purpose::STANDARD.encode(key.sign(payload.as_bytes()).to_bytes()),
        public_key: format!("ed25519:{}", near_sdk::bs58::encode(key.verifying_key().to_bytes()).into_string()),
        payload,
    }
}

fn empty_position() -> PositionSnapshot {
    PositionSnapshot { collateral: vec![], borrowed: vec![] }
}

fn vault() -> AegisVault {
    as_caller("admin.near", 1000);
    let pinned = format!("ed25519:{}", near_sdk::bs58::encode(oracle_key().verifying_key().to_bytes()).into_string());
    let mut v = AegisVault::new(id("admin.near"), pinned, id("burrow.near"), id("ref.near"), id("outlayer.near"), id("intents.near"));
    v.set_enclave(hex::encode(enclave_key().verifying_key().to_bytes()), "cd".repeat(32));
    v.set_outlayer_project("admin.near/aegis".into(), "default".into(), "admin.near".into());
    v.register_keeper(id("keeper.near"));
    as_caller("alice.near", 1000);
    v.register_policy("ab".repeat(32), "Y2lwaGVy".into(), vec!["nep141:base-usdc.omft.near".into()], "nep141:usdc.near".into());
    v.finish_set_position(id("alice.near"), id("alice.pos.vault.near"), Some(id("alice.near")));
    v
}

fn lock(v: &mut AegisVault, req: &str) {
    v.locks.insert(id("alice.near"), RescueLock::InFlight { request_id: req.into() });
}

fn decision(req: &str, dry: bool, action: RescueAction) -> EnclaveRescueDecision {
    let mut d = EnclaveRescueDecision {
        request_id: req.into(),
        account_id: id("alice.near"),
        observed_hf_bps: 10700,
        trigger_hf_bps: 10800,
        target_hf_bps: 12500,
        action,
        repay_amount_raw: "345600000".into(),
        oneclick_quote: Some(OneClickQuotePayload {
            quote_id: "q".into(),
            dry,
            deposit_address: "dep.near".into(),
            amount_in: "345950000".into(),
            amount_out: "345600000".into(),
            solver_spread_bps: 10,
            liquidation_penalty_saved_bps: 720,
        }),
        enclave_signature_hex: String::new(),
        attestation_sha256: "cd".repeat(32),
    };
    d.enclave_signature_hex = hex::encode(enclave_key().sign(&d.signing_message()).to_bytes());
    d
}

fn answer(d: &EnclaveRescueDecision) -> Option<serde_json::Value> {
    Some(serde_json::to_value(d).unwrap())
}

fn approved(v: &mut AegisVault) {
    lock(v, "r1");
    v.process_decision(id("alice.near"), "r1".into(), answer(&decision("r1", false, RescueAction::RepayDebt)));
}

// ---- Invariant 4: oracle ----
#[test]
fn fresh_signed_feed_is_accepted() {
    let v = vault();
    as_caller("keeper.near", 1030);
    v.assert_valid_oracle_payload(&feed(&oracle_key(), 1000));
}

#[test]
#[should_panic(expected = "ERR_STALE_ORACLE")]
fn stale_feed_is_rejected() {
    let v = vault();
    as_caller("keeper.near", 1061);
    v.assert_valid_oracle_payload(&feed(&oracle_key(), 1000));
}

#[test]
#[should_panic(expected = "ERR_BAD_ORACLE_SIGNATURE")]
fn feed_from_another_key_is_rejected() {
    let v = vault();
    as_caller("keeper.near", 1000);
    v.assert_valid_oracle_payload(&feed(&SigningKey::from_bytes(&[9u8; 32]), 1000));
}

#[test]
#[should_panic(expected = "ERR_BAD_ORACLE_SIGNATURE")]
fn tampered_feed_is_rejected() {
    let v = vault();
    as_caller("keeper.near", 1000);
    let mut f = feed(&oracle_key(), 1000);
    f.payload = f.payload.replace("428000000", "900000000");
    v.assert_valid_oracle_payload(&f);
}

// ---- trigger ----
#[test]
#[should_panic(expected = "ERR_OUTLAYER_NOT_CONFIGURED")]
fn trigger_needs_the_secrets_account_to_be_set() {
    let mut v = vault();
    as_caller("admin.near", 1000);
    v.set_outlayer_project("admin.near/aegis".into(), "default".into(), String::new());
    as_caller("keeper.near", 1000);
    let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1000), vec![]);
}

#[test]
#[should_panic(expected = "ERR_UNAUTHORIZED_KEEPER")]
fn only_keepers_can_trigger() {
    let mut v = vault();
    as_caller("evil.near", 1000);
    let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1000), vec![]);
}

#[test]
fn trigger_sets_the_lock_and_second_trigger_fails() {
    let mut v = vault();
    as_caller("keeper.near", 1000);
    let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1000), vec![]);
    assert!(matches!(v.get_lock(id("alice.near")), RescueLock::InFlight { .. }));
    let second = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1000), vec![]);
    }));
    assert!(second.is_err());
}

// ---- Invariant 3: decision handling ----
#[test]
fn signed_live_decision_becomes_a_ticket_and_keeps_the_lock() {
    let mut v = vault();
    approved(&mut v);
    let t = v.get_ticket("r1".into()).unwrap();
    assert_eq!(t.state, IntentLifecycleState::PendingDeposit);
    assert_eq!(t.deposit_account, id("dep.near"));
    assert_eq!(t.origin_token, id("base-usdc.omft.near"));
    assert!(matches!(v.get_lock(id("alice.near")), RescueLock::InFlight { .. }));
}

#[test]
fn forged_decision_is_refused_and_lock_freed() {
    let mut v = vault();
    lock(&mut v, "r1");
    let mut d = decision("r1", false, RescueAction::RepayDebt);
    d.oneclick_quote.as_mut().unwrap().deposit_address = "evil.near".into(); // changed after signing
    v.process_decision(id("alice.near"), "r1".into(), answer(&d));
    assert!(v.get_ticket("r1".into()).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
    assert!(get_logs().iter().any(|l| l.contains("ERR_BAD_ENCLAVE_SIGNATURE")));
}

#[test]
fn decision_signed_by_the_wrong_key_is_refused() {
    let mut v = vault();
    lock(&mut v, "r1");
    let mut d = decision("r1", false, RescueAction::RepayDebt);
    d.enclave_signature_hex = hex::encode(SigningKey::from_bytes(&[1u8; 32]).sign(&d.signing_message()).to_bytes());
    v.process_decision(id("alice.near"), "r1".into(), answer(&d));
    assert!(v.get_ticket("r1".into()).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn wrong_attestation_is_refused() {
    let mut v = vault();
    lock(&mut v, "r1");
    let mut d = decision("r1", false, RescueAction::RepayDebt);
    d.attestation_sha256 = "00".repeat(32);
    d.enclave_signature_hex = hex::encode(enclave_key().sign(&d.signing_message()).to_bytes());
    v.process_decision(id("alice.near"), "r1".into(), answer(&d));
    assert!(v.get_ticket("r1".into()).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn dry_run_decision_never_becomes_executable() {
    let mut v = vault();
    lock(&mut v, "r1");
    v.process_decision(id("alice.near"), "r1".into(), answer(&decision("r1", true, RescueAction::RepayDebt)));
    assert!(v.get_ticket("r1".into()).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn no_action_decision_frees_the_lock() {
    let mut v = vault();
    lock(&mut v, "r1");
    v.process_decision(id("alice.near"), "r1".into(), answer(&decision("r1", false, RescueAction::None)));
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn failed_enclave_call_frees_the_lock() {
    let mut v = vault();
    lock(&mut v, "r1");
    v.process_decision(id("alice.near"), "r1".into(), None);
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
#[should_panic(expected = "ERR_NO_LOCK_FOR_REQUEST")]
fn callback_without_matching_lock_is_rejected() {
    let mut v = vault();
    lock(&mut v, "other");
    v.process_decision(id("alice.near"), "r1".into(), answer(&decision("r1", false, RescueAction::RepayDebt)));
}

#[test]
fn decision_replayed_for_a_different_request_is_refused() {
    let mut v = vault();
    lock(&mut v, "r2");
    v.process_decision(id("alice.near"), "r2".into(), answer(&decision("r1", false, RescueAction::RepayDebt)));
    assert!(v.get_ticket("r1".into()).is_none() && v.get_ticket("r2".into()).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

// ---- Invariant 2: where money can go ----
#[test]
fn only_the_attested_deposit_address_is_allowed_during_a_rescue() {
    let mut v = vault();
    approved(&mut v);
    v.assert_attested_recipient(&id("alice.near"), &id("dep.near"));
    assert!(!v.is_recipient_allowed(id("alice.near"), id("dep.near"))); // not a standing allowance
    assert!(v.is_recipient_allowed(id("alice.near"), id("alice.pos.vault.near")));
}

#[test]
#[should_panic(expected = "ERR_UNAUTHORIZED_RECIPIENT")]
fn compromised_keeper_cannot_redirect_to_evil_address() {
    let mut v = vault();
    approved(&mut v);
    v.assert_attested_recipient(&id("alice.near"), &id("evil.near"));
}

#[test]
#[should_panic(expected = "ERR_UNAUTHORIZED_RECIPIENT")]
fn attested_address_is_useless_without_a_rescue() {
    let v = vault();
    v.assert_attested_recipient(&id("alice.near"), &id("dep.near"));
}

// ---- execute + final states (Invariant 5) ----
#[test]
fn keeper_executes_once_then_success_frees_the_lock() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000);
    let _ = v.execute_approved_rescue("r1".into());
    assert_eq!(v.get_ticket("r1".into()).unwrap().state, IntentLifecycleState::Processing);
    assert!(v.report_intent_status("r1".into(), IntentLifecycleState::Success).is_some());
    // not settled until Burrow confirms the repay
    assert_eq!(v.get_ticket("r1".into()).unwrap().state, IntentLifecycleState::Processing);
    assert_ne!(v.get_lock(id("alice.near")), RescueLock::Idle);
    v.finish_repay("r1".into(), Some(345_600_000));
    assert_eq!(v.get_ticket("r1".into()).unwrap().state, IntentLifecycleState::Success);
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

fn failed_repay_case(used: Option<u128>) {
    {
        let mut v = vault();
        approved(&mut v);
        as_caller("keeper.near", 1000);
        let _ = v.execute_approved_rescue("r1".into());
        let _ = v.report_intent_status("r1".into(), IntentLifecycleState::Success);
        v.finish_repay("r1".into(), used);
        assert_eq!(v.get_ticket("r1".into()).unwrap().state, IntentLifecycleState::Processing);
        assert_ne!(v.get_lock(id("alice.near")), RescueLock::Idle);
        // the keeper can retry
        assert!(v.report_intent_status("r1".into(), IntentLifecycleState::Success).is_some());
    }
}

#[test]
fn repay_call_failure_keeps_ticket_processing_and_locked() {
    failed_repay_case(None);
}

#[test]
fn repay_that_used_nothing_keeps_ticket_processing_and_locked() {
    failed_repay_case(Some(0));
}

#[test]
#[should_panic(expected = "ERR_TICKET_PROCESSING")]
fn owner_cannot_clear_lock_while_reserve_in_flight() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000);
    let _ = v.execute_approved_rescue("r1".into());
    as_caller("admin.near", 1100);
    v.force_clear_lock(id("alice.near"));
}

#[test]
fn owner_can_clear_a_stuck_processing_lock_after_an_hour() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000);
    let _ = v.execute_approved_rescue("r1".into());
    as_caller("admin.near", 1000 + 3601);
    v.force_clear_lock(id("alice.near"));
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
    assert_eq!(v.get_ticket("r1".into()).unwrap().state, IntentLifecycleState::Failed);
}

#[test]
#[should_panic(expected = "ERR_TICKET_EXPIRED")]
fn stale_ticket_cannot_be_executed() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000 + 301);
    let _ = v.execute_approved_rescue("r1".into());
}

#[test]
#[should_panic(expected = "ERR_TICKET_ALREADY_EXECUTED")]
fn ticket_cannot_be_executed_twice() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000);
    let _ = v.execute_approved_rescue("r1".into());
    let _ = v.execute_approved_rescue("r1".into());
}

#[test]
#[should_panic(expected = "ERR_UNAUTHORIZED_KEEPER")]
fn stranger_cannot_execute() {
    let mut v = vault();
    approved(&mut v);
    as_caller("evil.near", 1000);
    let _ = v.execute_approved_rescue("r1".into());
}

#[test]
fn refunded_and_failed_free_the_lock() {
    for status in [IntentLifecycleState::Refunded, IntentLifecycleState::Failed] {
        let mut v = vault();
        approved(&mut v);
        as_caller("keeper.near", 1000);
        let _ = v.execute_approved_rescue("r1".into());
        assert!(v.report_intent_status("r1".into(), status).is_none());
        assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
        assert!(get_logs().iter().any(|l| l.contains("FALLBACK_NEEDED")));
    }
}

#[test]
#[should_panic(expected = "ERR_BAD_STATE_TRANSITION")]
fn cannot_skip_to_success_before_processing() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000);
    let _ = v.report_intent_status("r1".into(), IntentLifecycleState::Success);
}

#[test]
#[should_panic(expected = "ERR_BAD_STATE_TRANSITION")]
fn terminal_state_is_final() {
    let mut v = vault();
    approved(&mut v);
    as_caller("keeper.near", 1000);
    let _ = v.execute_approved_rescue("r1".into());
    let _ = v.report_intent_status("r1".into(), IntentLifecycleState::Failed);
    let _ = v.report_intent_status("r1".into(), IntentLifecycleState::Success);
}
