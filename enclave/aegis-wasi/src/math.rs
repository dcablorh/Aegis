//! Whole-number loan maths. USD amounts are micro-USD (1_000_000 = $1); ratios are basis points.

use crate::oracle::VerifiedFeed;
use aegis_types::{PositionAsset, PositionSnapshot};

pub const BPS: u128 = 10_000;
/// Expected cross-chain settlement time used in the volatility buffer (seconds).
pub const SETTLE_SECONDS: u128 = 45;
/// 2.33 (99% one-sided) in hundredths.
pub const K_X100: u128 = 233;
/// Base safety margin over 1.0: HF 1.02.
pub const BASE_TRIGGER_BPS: u128 = 10_200;
/// Assumed collateral drop used to price the liquidation penalty we avoid (documented assumption).
pub const STRESS_DROP_BPS: u128 = 2_000;

#[derive(Debug, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    BadAmount,
    NoDebt,
    NoCollateral,
    NoPrice(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Health {
    pub collateral_adj_usd: u128,
    pub borrow_adj_usd: u128,
    pub hf_bps: u128,
}

fn value_micro(a: &PositionAsset, price_micro: u128) -> Result<u128, MathError> {
    let amount: u128 = a.amount_raw.parse().map_err(|_| MathError::BadAmount)?;
    let scale = 10u128.checked_pow(a.decimals as u32).ok_or(MathError::Overflow)?;
    amount.checked_mul(price_micro).ok_or(MathError::Overflow).map(|v| v / scale)
}

pub fn health(pos: &PositionSnapshot, feed: &VerifiedFeed) -> Result<Health, MathError> {
    let (mut c, mut b) = (0u128, 0u128);
    for a in &pos.collateral {
        let p = feed.price_micro_usd(&a.token_id).map_err(|_| MathError::NoPrice(a.token_id.clone()))?;
        c += value_micro(a, p)? * a.weight_bps as u128 / BPS;
    }
    for a in &pos.borrowed {
        let p = feed.price_micro_usd(&a.token_id).map_err(|_| MathError::NoPrice(a.token_id.clone()))?;
        if a.weight_bps == 0 {
            return Err(MathError::BadAmount);
        }
        b += value_micro(a, p)? * BPS / a.weight_bps as u128;
    }
    if b == 0 {
        return Err(MathError::NoDebt);
    }
    if c == 0 {
        return Err(MathError::NoCollateral);
    }
    Ok(Health { collateral_adj_usd: c, borrow_adj_usd: b, hf_bps: c * BPS / b })
}

/// Realized volatility over the buffer window, in bps of price: `sigma * sqrt(tau)`.
/// `series` = (unix seconds, price micro-USD), oldest first.
pub fn buffered_sigma_bps(series: &[(u64, u128)]) -> u128 {
    let (mut sum_sq, mut total_dt) = (0u128, 0u128);
    for w in series.windows(2) {
        let dt = w[1].0.saturating_sub(w[0].0) as u128;
        if dt == 0 || w[0].1 == 0 {
            continue;
        }
        let r = w[1].1.abs_diff(w[0].1) * BPS / w[0].1;
        sum_sq += r * r;
        total_dt += dt;
    }
    if total_dt == 0 {
        return 0;
    }
    // variance per second (bps squared per second) times tau, then square root
    (sum_sq * SETTLE_SECONDS / total_dt).isqrt()
}

/// `HF_trigger = max(HF_min, 1.02 + 2.33 * sigma * sqrt(tau))`, in bps.
pub fn trigger_hf_bps(hf_min_bps: u32, sigma_bps: u128) -> u128 {
    (hf_min_bps as u128).max(BASE_TRIGGER_BPS + K_X100 * sigma_bps / 100)
}

/// Debt to repay (micro-USD) so that `C_adj / (B_adj - x / w) = target`, i.e.
/// `x = w * (B_adj - C_adj / target)`, rounded up. `w` is the borrowed asset's weight in bps.
pub fn repay_usd_micro(h: &Health, target_hf_bps: u32, borrow_weight_bps: u32) -> u128 {
    let needed_b = (h.collateral_adj_usd * BPS).div_ceil(target_hf_bps as u128);
    if h.borrow_adj_usd <= needed_b {
        return 0;
    }
    ((h.borrow_adj_usd - needed_b) * borrow_weight_bps as u128).div_ceil(BPS)
}

/// Converts micro-USD to raw token units (rounded up) at a micro-USD-per-whole-token price.
pub fn usd_to_raw(usd_micro: u128, price_micro: u128, decimals: u8) -> Result<u128, MathError> {
    if price_micro == 0 {
        return Err(MathError::BadAmount);
    }
    let scale = 10u128.checked_pow(decimals as u32).ok_or(MathError::Overflow)?;
    usd_micro.checked_mul(scale).ok_or(MathError::Overflow).map(|v| v.div_ceil(price_micro))
}

/// Rhea liquidation discount `(1 - HF) / 2`, in bps (0 when HF >= 1).
pub fn liquidation_discount_bps(hf_bps: u128) -> u128 {
    BPS.saturating_sub(hf_bps) / 2
}

/// Penalty we would avoid if collateral dropped by `STRESS_DROP_BPS` before the rescue.
pub fn penalty_saved_bps(observed_hf_bps: u128) -> u128 {
    liquidation_discount_bps(observed_hf_bps * (BPS - STRESS_DROP_BPS) / BPS)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::oracle::{testutil::*, verify_feed};

    fn asset(id: &str, raw: &str, dec: u8, w: u32) -> PositionAsset {
        PositionAsset { token_id: id.into(), amount_raw: raw.into(), decimals: dec, weight_bps: w }
    }

    /// 1000 wNEAR at $4.28 (weight 0.6) against 2400 USDC: the doc example, HF = 1.07.
    pub fn doc_example() -> (PositionSnapshot, VerifiedFeed) {
        let pos = PositionSnapshot {
            collateral: vec![asset("wrap.near", "1000000000000000000000000000", 24, 6000)],
            borrowed: vec![asset("usdc", "2400000000", 6, 10000)],
        };
        let f = verify_feed(
            &feed(&[("wrap.near", 428_000_000, 1000), ("usdc", 100_000_000, 1000)]),
            &pinned(),
            1000,
        )
        .unwrap();
        (pos, f)
    }

    #[test]
    fn health_matches_doc_example() {
        let (pos, f) = doc_example();
        let h = health(&pos, &f).unwrap();
        assert_eq!(h.collateral_adj_usd, 2_568_000_000);
        assert_eq!(h.borrow_adj_usd, 2_400_000_000);
        assert_eq!(h.hf_bps, 10_700);
    }

    #[test]
    fn repay_sizing_matches_doc_example() {
        let (pos, f) = doc_example();
        let h = health(&pos, &f).unwrap();
        // 2400 - 2568 / 1.25 = 345.60 USDC
        assert_eq!(repay_usd_micro(&h, 12_500, 10_000), 345_600_000);
        assert_eq!(usd_to_raw(345_600_000, 1_000_000, 6).unwrap(), 345_600_000);
        let after = h.collateral_adj_usd * BPS / (h.borrow_adj_usd - 345_600_000);
        assert_eq!(after, 12_500);
    }

    #[test]
    fn nothing_to_repay_when_already_healthy() {
        let h = Health { collateral_adj_usd: 3_000, borrow_adj_usd: 1_000, hf_bps: 30_000 };
        assert_eq!(repay_usd_micro(&h, 12_500, 10_000), 0);
    }

    #[test]
    fn no_debt_is_an_error() {
        let (mut pos, f) = doc_example();
        pos.borrowed.clear();
        assert_eq!(health(&pos, &f), Err(MathError::NoDebt));
    }

    #[test]
    fn flat_prices_have_zero_volatility_and_trigger_is_floor() {
        let s = [(0, 5_000_000u128), (10, 5_000_000), (20, 5_000_000)];
        assert_eq!(buffered_sigma_bps(&s), 0);
        assert_eq!(trigger_hf_bps(10_800, 0), 10_800);
        assert_eq!(trigger_hf_bps(10_100, 0), 10_200);
    }

    #[test]
    fn volatile_prices_raise_the_trigger() {
        let s = [(0, 5_000_000u128), (10, 5_050_000), (20, 5_000_000), (30, 5_050_000)];
        let sigma = buffered_sigma_bps(&s);
        assert!(sigma > 100, "{sigma}");
        assert!(trigger_hf_bps(10_100, sigma) > BASE_TRIGGER_BPS);
    }

    #[test]
    fn liquidation_discount_formula() {
        assert_eq!(liquidation_discount_bps(8_800), 600);
        assert_eq!(liquidation_discount_bps(10_700), 0);
        assert_eq!(penalty_saved_bps(10_700), 720);
    }
}
