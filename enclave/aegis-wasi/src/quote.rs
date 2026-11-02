//! NEAR Intents 1Click quote: request shape, response parsing and checks.
//! Response fields verified against https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote

use aegis_types::OneClickQuotePayload;
use serde::Deserialize;

/// What the enclave asks the solver for: exactly `amount` of `destination_asset` delivered to `recipient`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuoteRequest {
    pub dry: bool,
    pub origin_asset: String,
    pub destination_asset: String,
    pub amount_out_raw: String,
    pub recipient: String,
    pub refund_to: String,
    pub slippage_bps: u32,
}

/// Where the raw 1Click JSON comes from. Live HTTP and offline fixtures both implement it.
pub trait QuoteSource {
    fn fetch(&self, req: &QuoteRequest) -> Result<String, String>;
}

/// Offline source for tests and the offline judge run. Never talks to the network.
pub struct FixtureQuote(pub String);

impl QuoteSource for FixtureQuote {
    fn fetch(&self, _req: &QuoteRequest) -> Result<String, String> {
        Ok(self.0.clone())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum QuoteError {
    BadJson,
    DryMismatch,
    MissingDepositAddress,
    BadAmount,
    /// Solver would deliver less than the amount we need.
    ShortDelivery,
}

#[derive(Deserialize)]
struct Response {
    #[serde(rename = "correlationId", default)]
    correlation_id: String,
    #[serde(rename = "quoteRequest")]
    request: Req,
    quote: Quote,
}

#[derive(Deserialize)]
struct Req {
    dry: bool,
}

#[derive(Deserialize)]
struct Quote {
    #[serde(rename = "depositAddress", default)]
    deposit_address: Option<String>,
    #[serde(rename = "amountIn")]
    amount_in: String,
    #[serde(rename = "amountInUsd")]
    amount_in_usd: String,
    #[serde(rename = "amountOut")]
    amount_out: String,
    #[serde(rename = "amountOutUsd")]
    amount_out_usd: String,
}

/// "345.95" -> 345_950_000 micro-USD. No floats.
pub fn parse_usd_micro(s: &str) -> Option<u128> {
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let frac6: String = frac.chars().chain("000000".chars()).take(6).collect();
    let w: u128 = whole.parse().ok()?;
    let f: u128 = frac6.parse().ok()?;
    w.checked_mul(1_000_000)?.checked_add(f)
}

/// Turns a raw 1Click response into the on-chain payload and checks it matches what was asked.
pub fn check_quote(
    raw_json: &str,
    expect_dry: bool,
    need_out_raw: u128,
    penalty_saved_bps: u32,
) -> Result<OneClickQuotePayload, QuoteError> {
    let r: Response = serde_json::from_str(raw_json).map_err(|_| QuoteError::BadJson)?;
    if r.request.dry != expect_dry {
        return Err(QuoteError::DryMismatch);
    }
    let deposit_address = match (&r.quote.deposit_address, expect_dry) {
        (Some(a), false) if !a.is_empty() => a.clone(),
        (_, false) => return Err(QuoteError::MissingDepositAddress),
        (_, true) => "dry_run".to_string(),
    };
    let out: u128 = r.quote.amount_out.parse().map_err(|_| QuoteError::BadAmount)?;
    let _in: u128 = r.quote.amount_in.parse().map_err(|_| QuoteError::BadAmount)?;
    if out < need_out_raw {
        return Err(QuoteError::ShortDelivery);
    }
    let usd_in = parse_usd_micro(&r.quote.amount_in_usd).ok_or(QuoteError::BadAmount)?;
    let usd_out = parse_usd_micro(&r.quote.amount_out_usd).ok_or(QuoteError::BadAmount)?;
    if usd_out == 0 {
        return Err(QuoteError::BadAmount);
    }
    let spread = (usd_in.saturating_sub(usd_out) * 10_000 / usd_out).min(u32::MAX as u128) as u32;
    Ok(OneClickQuotePayload {
        quote_id: r.correlation_id,
        dry: expect_dry,
        deposit_address,
        amount_in: r.quote.amount_in,
        amount_out: r.quote.amount_out,
        solver_spread_bps: spread,
        liquidation_penalty_saved_bps: penalty_saved_bps,
    })
}

#[cfg(test)]
pub fn sample_json(dry: bool, amount_in_usd: &str, amount_out: &str) -> String {
    let deposit = if dry { String::new() } else { r#""depositAddress":"dep123","#.to_string() };
    format!(
        r#"{{"correlationId":"corr-1","quoteRequest":{{"dry":{dry}}},"quote":{{{deposit}"amountIn":"345950000","amountInUsd":"{amount_in_usd}","amountOut":"{amount_out}","amountOutUsd":"345.60"}}}}"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usd_parsing() {
        assert_eq!(parse_usd_micro("345.6"), Some(345_600_000));
        assert_eq!(parse_usd_micro("345.123456789"), Some(345_123_456));
        assert_eq!(parse_usd_micro("7"), Some(7_000_000));
        assert_eq!(parse_usd_micro("x"), None);
    }

    #[test]
    fn dry_quote_is_checked_and_spread_computed() {
        let q = check_quote(&sample_json(true, "345.95", "345600000"), true, 345_600_000, 720).unwrap();
        assert!(q.dry && q.deposit_address == "dry_run");
        assert_eq!(q.solver_spread_bps, 10); // (345.95-345.60)/345.60 = 0.10%
        assert_eq!(q.liquidation_penalty_saved_bps, 720);
    }

    #[test]
    fn live_quote_needs_deposit_address() {
        assert_eq!(check_quote(&sample_json(true, "345.95", "345600000"), false, 1, 0), Err(QuoteError::DryMismatch));
        let q = check_quote(&sample_json(false, "345.95", "345600000"), false, 345_600_000, 0).unwrap();
        assert_eq!(q.deposit_address, "dep123");
    }

    #[test]
    fn short_delivery_is_rejected() {
        assert_eq!(
            check_quote(&sample_json(true, "345.95", "345599999"), true, 345_600_000, 0),
            Err(QuoteError::ShortDelivery)
        );
    }
}
