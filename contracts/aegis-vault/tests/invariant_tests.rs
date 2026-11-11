//! One test group per on-chain invariant from NEAR_HACKATHON_PROJECT_CONTEXT.md (Part V).
//! These call only public vault methods, the way a real caller would.

mod common;

use aegis_types::{IntentLifecycleState, RescueAction, RescueLock};
use common::*;

// ---- Invariant 1: no plaintext policy on chain ----
#[test]
fn invariant_1_storage_holds_only_hash_and_ciphertext() {
    let mut v = vault();
    at("alice.near", 1000);
    // register again with recognisable "ciphertext" so we can tell it apart from anything else
    v.register_policy("ab".repeat(32), "Y2lwaGVydGV4dA==".into(), vec!["nep141:base-usdc.omft.near".into()], "nep141:usdc.near".into());
    drop(v); // the store collections write to storage when dropped, as the runtime does at the end of a call
    let storage = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
    let all: Vec<u8> = storage.iter().flat_map(|(k, val)| k.iter().chain(val.iter()).copied()).collect();
    let text = String::from_utf8_lossy(&all);
    for needle in ["hf_min", "hf_target", "max_slippage", "10800", "12500", "salt"] {
        assert!(!text.contains(needle), "storage leaks `{needle}`");
    }
    assert!(all.windows(32).any(|w| w == [0xab; 32]), "the commitment hash should be stored");
}

// ---- Invariant 2: money only goes to allowed places ----
#[test]
fn invariant_2_fixed_recipient_allowlist() {
    let v = vault();
    for ok in ["alice.near", "alice.pos.vault.near", "burrow.near", "ref.near", "intents.near"] {
        assert!(v.is_recipient_allowed(id("alice.near"), id(ok)), "{ok} should be allowed");
    }
    for bad in ["evil.near", "bob.near", "keeper.near", "admin.near", "outlayer.near", "dep.near"] {
        assert!(!v.is_recipient_allowed(id("alice.near"), id(bad)), "{bad} must not be allowed");
    }
}

#[test]
fn invariant_2_swap_deposit_address_is_allowed_only_inside_a_signed_ticket() {
    let mut v = vault();
    assert!(!v.is_recipient_allowed(id("alice.near"), id("dep.near")));
    let req = approved(&mut v);
    // the ticket names dep.near, so that is where the reserve goes, and nowhere else
    let ticket = v.get_ticket(req).unwrap();
    assert_eq!(ticket.deposit_account, id("dep.near"));
    assert!(!v.is_recipient_allowed(id("alice.near"), id("dep.near")), "never a standing allowance");
}

// ---- Invariant 3: only a genuine, matching enclave answer completes a rescue ----
// Note: that only the vault itself may call `on_enclave_decision` is enforced by `#[private]` in the
// generated contract entry point, which only exists in the wasm build. It is checked on testnet (M7),
// not here. These tests cover everything the function itself decides.
#[test]
fn invariant_3_answer_without_a_running_rescue_is_rejected() {
    let mut v = vault();
    let msg = blocked(|| deliver(&mut v, "r-nothing", &good_decision("r-nothing")));
    assert!(msg.contains("ERR_NO_LOCK_FOR_REQUEST"), "{msg}");
}

#[test]
fn invariant_3_answer_for_another_request_does_not_pass() {
    let mut v = vault();
    let req = trigger(&mut v);
    deliver(&mut v, &req, &good_decision("some-older-request"));
    assert!(v.get_ticket(req).is_none() && v.get_ticket("some-older-request".into()).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn invariant_3_answer_not_signed_by_the_enclave_does_not_pass() {
    let mut v = vault();
    let req = trigger(&mut v);
    let forged = decision_signed_by(&oracle_key(), &req, false, RescueAction::RepayDebt, "dep.near");
    deliver(&mut v, &req, &forged);
    assert!(v.get_ticket(req).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn invariant_3_good_answer_for_the_running_rescue_passes() {
    let mut v = vault();
    let req = approved(&mut v);
    assert!(v.get_ticket(req).is_some());
    assert!(matches!(v.get_lock(id("alice.near")), RescueLock::InFlight { .. }));
}

// ---- Invariant 4: prices must be signed by the pinned oracle and fresh ----
fn trigger_with(v: &mut aegis_vault::AegisVault, feed: aegis_types::OraclePricePayload, now: u64) -> String {
    at("keeper.near", now);
    blocked(|| {
        let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed, vec![]);
    })
}

#[test]
fn invariant_4_stale_forged_and_foreign_prices_are_rejected() {
    let mut v = vault();
    assert!(trigger_with(&mut v, feed(&oracle_key(), 1000), 1061).contains("ERR_STALE_ORACLE"));
    assert!(trigger_with(&mut v, feed(&enclave_key(), 1000), 1000).contains("ERR_BAD_ORACLE_SIGNATURE"));
    let mut tampered = feed(&oracle_key(), 1000);
    tampered.payload = tampered.payload.replace("428000000", "100");
    assert!(trigger_with(&mut v, tampered, 1000).contains("ERR_BAD_ORACLE_SIGNATURE"));
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle, "a rejected price must not lock anyone");
}

#[test]
fn invariant_4_a_price_exactly_sixty_seconds_old_is_still_accepted() {
    let mut v = vault();
    at("keeper.near", 1060);
    let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1000), vec![]);
    assert!(matches!(v.get_lock(id("alice.near")), RescueLock::InFlight { .. }));
}

// ---- Invariant 5: every ending frees the lock, and the order of states is enforced ----
#[test]
fn invariant_5_every_terminal_state_frees_the_lock() {
    for end in [IntentLifecycleState::Success, IntentLifecycleState::Refunded, IntentLifecycleState::Failed] {
        let mut v = vault();
        let req = approved(&mut v);
        at("keeper.near", 1002);
        let _ = v.execute_approved_rescue(req.clone());
        let _ = v.report_intent_status(req.clone(), end);
        if end == IntentLifecycleState::Success {
            // success is only final once Burrow confirms the repay
            assert_ne!(v.get_lock(id("alice.near")), RescueLock::Idle);
            v.finish_repay(req.clone(), Some(1));
        }
        assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle, "{end:?} left the lock held");
        assert_eq!(v.get_ticket(req).unwrap().state, end);
    }
}

#[test]
fn invariant_5_no_answer_or_no_action_also_frees_the_lock() {
    let mut v = vault();
    let req = trigger(&mut v);
    at("vault.near", 1001);
    v.on_enclave_decision(id("alice.near"), req, Err(near_sdk::PromiseError::Failed));
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);

    let req = trigger(&mut v);
    deliver(&mut v, &req, &decision_signed_by(&enclave_key(), &req, false, RescueAction::None, "dep.near"));
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}

#[test]
fn invariant_5_states_cannot_skip_or_go_backwards() {
    let mut v = vault();
    let req = approved(&mut v);
    at("keeper.near", 1002);
    assert!(blocked(|| { let _ = v.report_intent_status(req.clone(), IntentLifecycleState::Success); }).contains("ERR_BAD_STATE_TRANSITION"));
    let _ = v.execute_approved_rescue(req.clone());
    let _ = v.report_intent_status(req.clone(), IntentLifecycleState::Failed);
    assert!(blocked(|| { let _ = v.report_intent_status(req.clone(), IntentLifecycleState::Success); }).contains("ERR_BAD_STATE_TRANSITION"));
}
