//! AegisMargin enclave: the private part of a rescue. Runs inside OutLayer (wasm32-wasip1) and natively for tests.
//!
//! stdin: `EnclaveExecutionInput` JSON. stdout: signed `EnclaveRescueDecision` JSON.

pub mod crypto;
pub mod math;
pub mod oracle;
pub mod quote;

use aegis_types::{EnclaveExecutionInput, EnclaveRescueDecision, RescueAction};
use ed25519_dalek::SigningKey;
use quote::{QuoteError, QuoteRequest, QuoteSource};

/// Secrets and settings the enclave receives from OutLayer as environment variables.
pub struct EnclaveConfig {
    pub policy_secret: [u8; 32],
    pub signing_key: SigningKey,
    /// Pinned `ed25519:` key of the price oracle.
    pub oracle_pubkey: String,
    pub attestation_sha256: String,
    /// Where the swap output should land (the vault).
    pub recipient: String,
    pub refund_to: String,
    /// false = 1Click dry-run quote (no money moves); true = real deposit address.
    pub live: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DecideError {
    Oracle(oracle::OracleError),
    Policy(crypto::CryptoError),
    Math(math::MathError),
    Quote(String),
    NoOriginAsset,
    NoBorrowedAsset,
}

/// Why the enclave did what it did. Printed to stderr for humans; not part of the signed decision.
#[derive(Debug, PartialEq, Eq)]
pub enum Reason {
    AboveTrigger,
    NothingToRepay,
    QuoteRejected(String),
    Rescue,
}

fn none_decision(input: &EnclaveExecutionInput, observed: u128, trigger: u128, target: u32) -> EnclaveRescueDecision {
    EnclaveRescueDecision {
        request_id: input.request_id.clone(),
        account_id: input.account_id.clone(),
        observed_hf_bps: observed as u32,
        trigger_hf_bps: trigger as u32,
        target_hf_bps: target,
        action: RescueAction::None,
        repay_amount_raw: "0".into(),
        oneclick_quote: None,
        enclave_signature_hex: String::new(),
        attestation_sha256: String::new(),
    }
}

pub fn decide(
    input: &EnclaveExecutionInput,
    cfg: &EnclaveConfig,
    quotes: &dyn QuoteSource,
) -> Result<(EnclaveRescueDecision, Reason), DecideError> {
    // 1. prices: pinned key, signature, freshness (Invariant 4)
    let feed = oracle::verify_feed(&input.price, &cfg.oracle_pubkey, input.now_unix_s).map_err(DecideError::Oracle)?;
    let mut series_feeds = Vec::new();
    for old in &input.price_history {
        // history may be older than 60s, so judge freshness against the feed's own time
        let t = serde_json::from_str::<serde_json::Value>(&old.payload)
            .ok()
            .and_then(|v| v.as_object()?.values().filter_map(|e| e["publish_time"].as_u64()).max())
            .unwrap_or(0);
        series_feeds.push(oracle::verify_feed(old, &cfg.oracle_pubkey, t).map_err(DecideError::Oracle)?);
    }
    series_feeds.push(feed.clone());

    // 2. private policy, checked against the on-chain commitment (Invariant 1)
    let policy = crypto::decrypt_policy(
        &input.policy.encrypted_payload_base64,
        cfg.policy_secret,
        &input.policy.policy_commitment_hash,
    )
    .map_err(DecideError::Policy)?;

    // 3. health and volatility-buffered trigger
    let h = math::health(&input.position, &feed).map_err(DecideError::Math)?;
    let col = input.position.collateral.first().ok_or(DecideError::Math(math::MathError::NoCollateral))?;
    let series: Vec<(u64, u128)> = series_feeds
        .iter()
        .filter_map(|f| f.price_micro_usd(&col.token_id).ok().map(|p| (f.time_s(), p)))
        .collect();
    let trigger = math::trigger_hf_bps(policy.hf_min_bps, math::buffered_sigma_bps(&series));

    let finish = |mut d: EnclaveRescueDecision, why: Reason| {
        d.attestation_sha256 = cfg.attestation_sha256.clone();
        crypto::sign_decision(&mut d, &cfg.signing_key);
        Ok((d, why))
    };

    if h.hf_bps > trigger {
        return finish(none_decision(input, h.hf_bps, trigger, policy.hf_target_bps), Reason::AboveTrigger);
    }

    // 4. exact repayment size
    let debt = input.position.borrowed.first().ok_or(DecideError::NoBorrowedAsset)?;
    let usd = math::repay_usd_micro(&h, policy.hf_target_bps, debt.weight_bps);
    if usd == 0 {
        return finish(none_decision(input, h.hf_bps, trigger, policy.hf_target_bps), Reason::NothingToRepay);
    }
    let debt_price = feed.price_micro_usd(&debt.token_id).map_err(|_| DecideError::Math(math::MathError::NoPrice(debt.token_id.clone())))?;
    let repay_raw = math::usd_to_raw(usd, debt_price, debt.decimals).map_err(DecideError::Math)?;

    // 5. ask the solver, then apply the arbitrage guard: spread within the borrower's limit and below the penalty we avoid
    let origin = input.policy.allowed_origin_assets.first().ok_or(DecideError::NoOriginAsset)?.clone();
    let req = QuoteRequest {
        dry: !cfg.live,
        origin_asset: origin,
        destination_asset: input.policy.target_repay_asset.clone(),
        amount_out_raw: repay_raw.to_string(),
        recipient: cfg.recipient.clone(),
        refund_to: cfg.refund_to.clone(),
        slippage_bps: policy.max_slippage_bps,
    };
    let raw = quotes.fetch(&req).map_err(DecideError::Quote)?;
    let saved = math::penalty_saved_bps(h.hf_bps) as u32;
    let q = match quote::check_quote(&raw, !cfg.live, repay_raw, saved) {
        Ok(q) => q,
        Err(e) => {
            let why = Reason::QuoteRejected(format!("{e:?}"));
            return finish(none_decision(input, h.hf_bps, trigger, policy.hf_target_bps), why);
        }
    };
    if q.solver_spread_bps > policy.max_slippage_bps || q.solver_spread_bps >= saved {
        let why = Reason::QuoteRejected(format!("{:?}", QuoteError::ShortDelivery).replace("ShortDelivery", "SpreadTooHigh"));
        return finish(none_decision(input, h.hf_bps, trigger, policy.hf_target_bps), why);
    }

    let mut d = none_decision(input, h.hf_bps, trigger, policy.hf_target_bps);
    d.action = RescueAction::RepayDebt;
    d.repay_amount_raw = repay_raw.to_string();
    d.oneclick_quote = Some(q);
    finish(d, Reason::Rescue)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{encrypt_policy, enclave_public_key};
    use crate::math::tests::doc_example;
    use crate::oracle::testutil::{feed, pinned};
    use crate::quote::{sample_json, FixtureQuote};
    use aegis_types::{EncryptedSolvencyPolicy, PolicyPlaintext};
    use ed25519_dalek::{Signature, Verifier};

    const ENCLAVE_SECRET: [u8; 32] = [3u8; 32];

    fn cfg() -> EnclaveConfig {
        EnclaveConfig {
            policy_secret: ENCLAVE_SECRET,
            signing_key: SigningKey::from_bytes(&[8u8; 32]),
            oracle_pubkey: pinned(),
            attestation_sha256: "cd".repeat(32),
            recipient: "aegis-vault.testnet".into(),
            refund_to: "0xrefund".into(),
            live: false,
        }
    }

    fn input(hf_min: u32, max_slip: u32) -> EnclaveExecutionInput {
        let (position, _) = doc_example();
        let plain = PolicyPlaintext { hf_min_bps: hf_min, hf_target_bps: 12_500, max_slippage_bps: max_slip, salt_hex: "a1b2".into() };
        EnclaveExecutionInput {
            request_id: "req-1".into(),
            account_id: "alice.near".parse().unwrap(),
            policy: EncryptedSolvencyPolicy {
                owner_id: "alice.near".parse().unwrap(),
                policy_commitment_hash: plain.commitment_hash().unwrap(),
                encrypted_payload_base64: encrypt_policy(&plain, &enclave_public_key(ENCLAVE_SECRET), [5u8; 32], [1u8; 12]),
                allowed_origin_assets: vec!["nep141:base-usdc.omft.near".into()],
                target_repay_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1".into(),
            },
            position,
            price: feed(&[("wrap.near", 428_000_000, 1000), ("usdc", 100_000_000, 1000)]),
            price_history: vec![],
            now_unix_s: 1000,
        }
    }

    fn quotes(spread_usd_in: &str) -> FixtureQuote {
        FixtureQuote(sample_json(true, spread_usd_in, "345600000"))
    }

    #[test]
    fn doc_example_triggers_and_repays_345_60() {
        // HF 1.07 <= trigger 1.08
        let (d, why) = decide(&input(10_800, 35), &cfg(), &quotes("345.95")).unwrap();
        assert_eq!(why, Reason::Rescue);
        assert_eq!(d.action, RescueAction::RepayDebt);
        assert_eq!((d.observed_hf_bps, d.trigger_hf_bps, d.target_hf_bps), (10_700, 10_800, 12_500));
        assert_eq!(d.repay_amount_raw, "345600000");
        let q = d.oneclick_quote.unwrap();
        assert!(q.dry);
        assert_eq!((q.solver_spread_bps, q.liquidation_penalty_saved_bps), (10, 720));
        assert_eq!(d.attestation_sha256, "cd".repeat(32));
    }

    #[test]
    fn signed_decision_fits_outlayer_900_byte_output_limit() {
        // OutLayer truncates stdout above 900 bytes, which would break the JSON the vault has to parse.
        let (d, _) = decide(&input(10_800, 35), &cfg(), &quotes("345.95")).unwrap();
        let mut d = d;
        // worst realistic case: long 1Click correlation id and a 64-char implicit-account deposit address
        let q = d.oneclick_quote.as_mut().unwrap();
        q.quote_id = "x".repeat(36);
        q.deposit_address = "a".repeat(64);
        let len = serde_json::to_string(&d).unwrap().len();
        println!("decision json bytes: {len}");
        assert!(len <= 900, "decision is {len} bytes");
    }

    #[test]
    fn decision_is_signed_by_the_enclave_key() {
        let (d, _) = decide(&input(10_800, 35), &cfg(), &quotes("345.95")).unwrap();
        let sig = Signature::from_slice(&hex::decode(&d.enclave_signature_hex).unwrap()).unwrap();
        assert!(cfg().signing_key.verifying_key().verify(&d.signing_message(), &sig).is_ok());
    }

    #[test]
    fn healthy_position_does_nothing() {
        // trigger floor 1.05 < HF 1.07
        let (d, why) = decide(&input(10_500, 35), &cfg(), &quotes("345.95")).unwrap();
        assert_eq!((d.action, why), (RescueAction::None, Reason::AboveTrigger));
        assert!(d.oneclick_quote.is_none());
    }

    #[test]
    fn expensive_solver_is_rejected_by_the_guard() {
        // spread 10 bps > borrower limit 5 bps
        let (d, why) = decide(&input(10_800, 5), &cfg(), &quotes("345.95")).unwrap();
        assert_eq!(d.action, RescueAction::None);
        assert!(matches!(why, Reason::QuoteRejected(_)));
        // spread 50 bps is within a 100 bps limit and well below the 720 bps penalty -> allowed
        assert_eq!(decide(&input(10_800, 100), &cfg(), &quotes("347.33")).unwrap().0.action, RescueAction::RepayDebt);
    }

    #[test]
    fn forged_prices_are_refused() {
        let mut i = input(10_800, 35);
        i.price.payload = i.price.payload.replace("428000000", "900000000");
        assert!(matches!(decide(&i, &cfg(), &quotes("345.95")), Err(DecideError::Oracle(_))));
    }

    #[test]
    fn stale_prices_are_refused() {
        let mut i = input(10_800, 35);
        i.now_unix_s = 2000;
        assert_eq!(decide(&i, &cfg(), &quotes("345.95")).unwrap_err(), DecideError::Oracle(oracle::OracleError::Stale));
    }

    #[test]
    fn swapped_ciphertext_is_refused() {
        let mut i = input(10_800, 35);
        i.policy.policy_commitment_hash = [0u8; 32];
        assert_eq!(decide(&i, &cfg(), &quotes("345.95")).unwrap_err(), DecideError::Policy(crypto::CryptoError::CommitmentMismatch));
    }

    #[test]
    fn volatility_history_raises_the_trigger() {
        // calm policy floor 1.0 + volatile history pushes trigger above HF 1.07 even with a low hf_min
        let mut i = input(10_100, 100);
        i.price_history = vec![
            feed(&[("wrap.near", 400_000_000, 940), ("usdc", 100_000_000, 940)]),
            feed(&[("wrap.near", 440_000_000, 970), ("usdc", 100_000_000, 970)]),
        ];
        let (d, why) = decide(&i, &cfg(), &quotes("347.33")).unwrap();
        assert!(d.trigger_hf_bps > 10_700, "{}", d.trigger_hf_bps);
        assert_eq!(why, Reason::Rescue);
    }
}
