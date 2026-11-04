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
    /// Unix seconds when the request was made; the refund deadline is derived from it.
    pub now_unix_s: u64,
}

/// How long a swap may take before 1Click starts refunding.
const DEADLINE_SECONDS: u64 = 3600;

/// `1793809700` -> `2026-11-04T16:28:20Z`. Civil-date arithmetic, no clock or time crate needed.
pub fn iso8601_utc(secs: u64) -> String {
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// The JSON body for `POST /v0/quote` (field names from the 1Click API reference).
pub fn build_request_body(req: &QuoteRequest) -> String {
    serde_json::json!({
        "dry": req.dry,
        "swapType": "EXACT_OUTPUT",
        "slippageTolerance": req.slippage_bps,
        "originAsset": req.origin_asset,
        "depositType": "ORIGIN_CHAIN",
        "destinationAsset": req.destination_asset,
        "amount": req.amount_out_raw,
        "refundTo": req.refund_to,
        "refundType": "ORIGIN_CHAIN",
        "recipient": req.recipient,
        "recipientType": "DESTINATION_CHAIN",
        "deadline": iso8601_utc(req.now_unix_s + DEADLINE_SECONDS),
    })
    .to_string()
}

/// Live 1Click over HTTP. Only exists inside the wasip2 sandbox (OutLayer), where outbound HTTP is allowed.
#[cfg(target_os = "wasi")]
pub struct HttpQuote {
    pub url: String,
}

#[cfg(target_os = "wasi")]
impl QuoteSource for HttpQuote {
    fn fetch(&self, req: &QuoteRequest) -> Result<String, String> {
        let body = build_request_body(req);
        let resp = wasi_http_client::Client::new()
            .post(&self.url)
            .header("Content-Type", "application/json")
            .body(body.as_bytes())
            .connect_timeout(std::time::Duration::from_secs(8))
            .send()
            .map_err(|e| format!("1click request failed: {e}"))?;
        let status = resp.status();
        let bytes = resp.body().map_err(|e| format!("1click body failed: {e}"))?;
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if !(200..300).contains(&status) {
            return Err(format!("1click http {status}: {}", text.chars().take(200).collect::<String>()));
        }
        Ok(text)
    }
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
    fn iso_timestamps() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(951_782_400), "2000-02-29T00:00:00Z"); // leap day
        assert_eq!(iso8601_utc(1_793_809_700), "2026-11-04T16:28:20Z");
    }

    #[test]
    fn request_body_matches_the_1click_reference() {
        let req = QuoteRequest {
            dry: true,
            origin_asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near".into(),
            destination_asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1".into(),
            amount_out_raw: "345600000".into(),
            recipient: "intents.near".into(),
            refund_to: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D".into(),
            slippage_bps: 100,
            now_unix_s: 1_793_809_700,
        };
        let v: serde_json::Value = serde_json::from_str(&build_request_body(&req)).unwrap();
        assert_eq!(v["dry"], true);
        assert_eq!(v["swapType"], "EXACT_OUTPUT");
        assert_eq!(v["slippageTolerance"], 100);
        assert_eq!(v["amount"], "345600000");
        assert_eq!(v["depositType"], "ORIGIN_CHAIN");
        assert_eq!(v["recipientType"], "DESTINATION_CHAIN");
        assert_eq!(v["deadline"], "2026-11-04T17:28:20Z");
        assert_eq!(v.as_object().unwrap().len(), 12);
    }

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
