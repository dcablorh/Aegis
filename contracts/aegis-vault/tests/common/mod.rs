//! Shared setup for the integration tests. Everything here goes through the vault's public methods only.
#![allow(dead_code)]

use aegis_types::{
    EnclaveRescueDecision, OneClickQuotePayload, OraclePricePayload, PositionSnapshot, RescueAction, RescueLock,
};
use aegis_vault::AegisVault;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{serde_json, testing_env, AccountId};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// Run the next call as `who`, at unix second `ts_s`, with the vault deployed at `vault.near`.
pub fn at(who: &str, ts_s: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(id(who))
        .current_account_id(id("vault.near"))
        .block_timestamp(ts_s * 1_000_000_000)
        .build());
}

pub fn enclave_key() -> SigningKey {
    SigningKey::from_bytes(&[8u8; 32])
}

pub fn oracle_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

pub fn feed(key: &SigningKey, publish_time: u64) -> OraclePricePayload {
    let payload = format!(r#"{{"wrap.near":{{"price":"428000000","expo":-8,"publish_time":{publish_time}}}}}"#);
    OraclePricePayload {
        signature_b64: base64::engine::general_purpose::STANDARD.encode(key.sign(payload.as_bytes()).to_bytes()),
        public_key: format!("ed25519:{}", near_sdk::bs58::encode(key.verifying_key().to_bytes()).into_string()),
        payload,
    }
}

pub fn empty_position() -> PositionSnapshot {
    PositionSnapshot { collateral: vec![], borrowed: vec![] }
}

/// Vault with an owner, a pinned oracle and enclave, one keeper, and a policy + position for alice.
pub fn vault() -> AegisVault {
    at("admin.near", 1000);
    let pinned = format!("ed25519:{}", near_sdk::bs58::encode(oracle_key().verifying_key().to_bytes()).into_string());
    let mut v = AegisVault::new(id("admin.near"), pinned, id("burrow.near"), id("ref.near"), id("outlayer.near"), id("intents.near"));
    v.set_enclave(hex::encode(enclave_key().verifying_key().to_bytes()), "cd".repeat(32));
    v.set_outlayer_project("admin.near/aegis".into(), "default".into());
    v.register_keeper(id("keeper.near"));
    at("alice.near", 1000);
    v.register_policy("ab".repeat(32), "Y2lwaGVy".into(), vec!["nep141:base-usdc.omft.near".into()], "nep141:usdc.near".into());
    v.set_position(id("alice.pos.vault.near"));
    v
}

/// The keeper triggers a rescue through the real entry point; returns the request id the vault chose.
pub fn trigger(v: &mut AegisVault) -> String {
    at("keeper.near", 1000);
    let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1000), vec![]);
    match v.get_lock(id("alice.near")) {
        RescueLock::InFlight { request_id } => request_id,
        RescueLock::Idle => panic!("trigger did not lock"),
    }
}

/// A decision signed by `key` for `request_id`.
pub fn decision_signed_by(key: &SigningKey, request_id: &str, dry: bool, action: RescueAction, deposit: &str) -> EnclaveRescueDecision {
    let mut d = EnclaveRescueDecision {
        request_id: request_id.into(),
        account_id: id("alice.near"),
        observed_hf_bps: 10700,
        trigger_hf_bps: 10800,
        target_hf_bps: 12500,
        action,
        repay_amount_raw: "345600000".into(),
        oneclick_quote: Some(OneClickQuotePayload {
            quote_id: "q".into(),
            dry,
            deposit_address: deposit.into(),
            amount_in: "345950000".into(),
            amount_out: "345600000".into(),
            solver_spread_bps: 10,
            liquidation_penalty_saved_bps: 720,
        }),
        enclave_signature_hex: String::new(),
        attestation_sha256: "cd".repeat(32),
    };
    d.enclave_signature_hex = hex::encode(key.sign(&d.signing_message()).to_bytes());
    d
}

pub fn good_decision(request_id: &str) -> EnclaveRescueDecision {
    decision_signed_by(&enclave_key(), request_id, false, RescueAction::RepayDebt, "dep.near")
}

/// Delivers an enclave answer to the vault's callback, exactly as OutLayer's reply would arrive.
pub fn deliver(v: &mut AegisVault, request_id: &str, d: &EnclaveRescueDecision) {
    at("vault.near", 1001);
    v.on_enclave_decision(id("alice.near"), request_id.into(), Ok(serde_json::to_value(d).unwrap()));
}

/// Trigger + good answer: leaves an executable ticket and the lock held.
pub fn approved(v: &mut AegisVault) -> String {
    let req = trigger(v);
    deliver(v, &req, &good_decision(&req));
    req
}

/// Runs `f`, which must be refused. Returns the refusal message; fails the test if the attack succeeded.
pub fn blocked<F: FnOnce()>(f: F) -> String {
    match catch_unwind(AssertUnwindSafe(f)) {
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
        Ok(_) => panic!("the attack was NOT blocked"),
    }
}
