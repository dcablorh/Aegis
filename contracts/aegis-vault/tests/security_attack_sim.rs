//! Track 06 (AI Security & Defense) attack demo.
//!
//! A prompt-injected or compromised keeper agent tries to move a borrower's funds somewhere they should
//! never go. Each attack must be refused. Run with `--nocapture` to read the audit log:
//!
//!   cargo test -p aegis-vault --test security_attack_sim -- --nocapture

mod common;

use aegis_types::{IntentLifecycleState, RescueAction, RescueLock};
use common::*;

fn attack(name: &str, expect: &str, msg: &str) {
    println!("  [ATTACK ] {name}");
    println!("  [BLOCKED] {msg}");
    assert!(msg.contains(expect), "expected `{expect}` for `{name}`, got `{msg}`");
}

#[test]
fn a_compromised_keeper_cannot_drain_or_take_over_the_vault() {
    println!("\n=== AegisMargin attack simulation: compromised keeper `keeper.near` ===");
    let mut v = vault();

    // 1. The keeper wants to send funds straight to its own address. The vault has no "send to X" method, and
    //    its recipient rule says no.
    println!("\n-- 1. redirect funds to an attacker address");
    println!("  allowed for alice? evil.near = {}", v.is_recipient_allowed(id("alice.near"), id("evil.near")));
    assert!(!v.is_recipient_allowed(id("alice.near"), id("evil.near")));

    // 2. A rescue is genuinely running; the keeper swaps in its own address as the swap deposit address and
    //    signs it with a key it controls.
    println!("\n-- 2. forge an enclave decision that pays evil.near");
    let req = trigger(&mut v);
    let rogue = decision_signed_by(&oracle_key(), &req, false, RescueAction::RepayDebt, "evil.near");
    deliver(&mut v, &req, &rogue);
    println!("  [ATTACK ] decision signed with the wrong key, deposit address evil.near");
    println!("  [BLOCKED] ticket created: {}  lock freed: {}", v.get_ticket(req.clone()).is_some(), v.get_lock(id("alice.near")) == RescueLock::Idle);
    assert!(v.get_ticket(req).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);

    // 3. Take a real, signed decision and edit the deposit address afterwards.
    println!("\n-- 3. tamper with a genuine decision after the enclave signed it");
    let req = trigger(&mut v);
    let mut tampered = good_decision(&req);
    tampered.oneclick_quote.as_mut().unwrap().deposit_address = "evil.near".into();
    deliver(&mut v, &req, &tampered);
    println!("  [ATTACK ] changed deposit_address to evil.near after signing");
    println!("  [BLOCKED] ticket created: {}", v.get_ticket(req.clone()).is_some());
    assert!(v.get_ticket(req).is_none());

    // 4. Replay an old genuine answer against a new rescue.
    println!("\n-- 4. replay an old decision for a new request");
    let old = trigger(&mut v);
    let old_decision = good_decision(&old);
    deliver(&mut v, &old, &old_decision);
    let new = {
        at("admin.near", 1003);
        v.force_clear_lock(id("alice.near"));
        // a later block has a different random seed, so the vault picks a different request id
        near_sdk::testing_env!(near_sdk::test_utils::VMContextBuilder::new()
            .predecessor_account_id(id("keeper.near"))
            .current_account_id(id("vault.near"))
            .block_timestamp(1004 * 1_000_000_000)
            .random_seed([9u8; 32])
            .build());
        let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1004), vec![]);
        match v.get_lock(id("alice.near")) { RescueLock::InFlight { request_id } => request_id, _ => unreachable!() }
    };
    assert_ne!(old, new, "the second rescue must have its own request id");
    deliver(&mut v, &new, &old_decision);
    println!("  [ATTACK ] old signed decision (request {old}) offered for request {new}");
    println!("  [BLOCKED] ticket for new request: {}", v.get_ticket(new.clone()).is_some());
    assert!(v.get_ticket(new).is_none());
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);

    // 5. The keeper tries admin powers.
    println!("\n-- 5. grab control");
    at("keeper.near", 1005);
    attack("add itself as owner-level keeper", "ERR_NOT_OWNER", &blocked(|| v.register_keeper(id("keeper.near"))));
    attack("swap in its own enclave key", "ERR_NOT_OWNER", &blocked(|| v.set_enclave("00".repeat(32), String::new())));
    attack("clear someone's lock", "ERR_NOT_OWNER", &blocked(|| v.force_clear_lock(id("alice.near"))));

    // 6. A stranger tries to act as a keeper.
    println!("\n-- 6. an outsider pretends to be a keeper");
    at("evil.near", 1006);
    attack(
        "trigger a rescue",
        "ERR_UNAUTHORIZED_KEEPER",
        &blocked(|| { let _ = v.trigger_solvency_check(id("alice.near"), empty_position(), feed(&oracle_key(), 1006), vec![]); }),
    );

    // 7. Lie about the swap result to skip the checks.
    println!("\n-- 7. report SUCCESS before any money moved");
    let mut v = vault();
    let req = approved(&mut v);
    at("keeper.near", 1007);
    attack(
        "mark the swap SUCCESS without executing it",
        "ERR_BAD_STATE_TRANSITION",
        &blocked(|| { let _ = v.report_intent_status(req.clone(), IntentLifecycleState::Success); }),
    );
    let _ = v.execute_approved_rescue(req.clone());
    attack(
        "execute the same ticket twice",
        "ERR_TICKET_ALREADY_EXECUTED",
        &blocked(|| { let _ = v.execute_approved_rescue(req.clone()); }),
    );

    println!("\n=== all attacks refused; vault funds and policy untouched ===\n");
}

#[test]
fn a_genuine_rescue_still_goes_through_after_all_that() {
    // sanity check that the guards are not just refusing everything
    let mut v = vault();
    let req = approved(&mut v);
    at("keeper.near", 1002);
    let _ = v.execute_approved_rescue(req.clone());
    assert!(v.report_intent_status(req.clone(), IntentLifecycleState::Success).is_some());
    // a keeper's say-so alone does not free the lock; Burrow's confirmed repay does
    assert_ne!(v.get_lock(id("alice.near")), RescueLock::Idle);
    v.finish_repay(req, Some(345_600_000));
    assert_eq!(v.get_lock(id("alice.near")), RescueLock::Idle);
}
