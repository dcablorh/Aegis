//! Verifies the signed price feed from price-oracle and turns it into integer micro-USD prices.

use aegis_types::OraclePricePayload;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use std::collections::BTreeMap;

/// Invariant 4: a feed older than this is rejected.
pub const MAX_ORACLE_AGE_S: u64 = 60;

#[derive(Debug, PartialEq, Eq)]
pub enum OracleError {
    WrongKey,
    BadKey,
    BadSignature,
    BadPayload,
    Stale,
    MissingAsset(String),
}

#[derive(Deserialize)]
struct Entry {
    price: String,
    #[serde(default = "default_expo")]
    expo: i32,
    publish_time: u64,
}

fn default_expo() -> i32 {
    -8
}

/// One verified price point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedFeed {
    prices_micro_usd: BTreeMap<String, u128>,
    oldest_publish_time: u64,
    newest_publish_time: u64,
}

impl VerifiedFeed {
    /// Price of one whole token in micro-USD (1_000_000 = $1).
    pub fn price_micro_usd(&self, asset: &str) -> Result<u128, OracleError> {
        self.prices_micro_usd
            .get(asset)
            .copied()
            .ok_or_else(|| OracleError::MissingAsset(asset.to_string()))
    }

    /// Time of the feed for volatility spacing (oldest venue observation).
    pub fn time_s(&self) -> u64 {
        self.oldest_publish_time
    }
}

fn parse_key(pinned: &str) -> Result<VerifyingKey, OracleError> {
    let b58 = pinned.strip_prefix("ed25519:").unwrap_or(pinned);
    let bytes: [u8; 32] = bs58::decode(b58)
        .into_vec()
        .map_err(|_| OracleError::BadKey)?
        .try_into()
        .map_err(|_| OracleError::BadKey)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| OracleError::BadKey)
}

/// Checks key pin, signature over the raw payload bytes, and freshness against `now_unix_s`.
pub fn verify_feed(
    feed: &OraclePricePayload,
    pinned_key: &str,
    now_unix_s: u64,
) -> Result<VerifiedFeed, OracleError> {
    let key = parse_key(pinned_key)?;
    if parse_key(&feed.public_key)? != key {
        return Err(OracleError::WrongKey);
    }
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(&feed.signature_b64)
        .map_err(|_| OracleError::BadSignature)?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| OracleError::BadSignature)?;
    key.verify(feed.payload.as_bytes(), &sig)
        .map_err(|_| OracleError::BadSignature)?;

    let entries: BTreeMap<String, Entry> =
        serde_json::from_str(&feed.payload).map_err(|_| OracleError::BadPayload)?;
    if entries.is_empty() {
        return Err(OracleError::BadPayload);
    }
    let mut prices = BTreeMap::new();
    let (mut oldest, mut newest) = (u64::MAX, 0u64);
    for (asset, e) in entries {
        if now_unix_s.saturating_sub(e.publish_time) > MAX_ORACLE_AGE_S {
            return Err(OracleError::Stale);
        }
        let raw: u128 = e.price.parse().map_err(|_| OracleError::BadPayload)?;
        // price = raw * 10^expo USD; micro-USD = raw * 10^(expo + 6)
        let shift = e.expo + 6;
        let micro = if shift >= 0 {
            raw.checked_mul(10u128.checked_pow(shift as u32).ok_or(OracleError::BadPayload)?)
                .ok_or(OracleError::BadPayload)?
        } else {
            raw / 10u128.checked_pow((-shift) as u32).ok_or(OracleError::BadPayload)?
        };
        oldest = oldest.min(e.publish_time);
        newest = newest.max(e.publish_time);
        prices.insert(asset, micro);
    }
    Ok(VerifiedFeed { prices_micro_usd: prices, oldest_publish_time: oldest, newest_publish_time: newest })
}

#[cfg(test)]
pub mod testutil {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    pub fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    pub fn pinned() -> String {
        format!("ed25519:{}", bs58::encode(signing_key().verifying_key().to_bytes()).into_string())
    }

    /// `prices`: (asset, price in 1e-8 USD units, publish_time)
    pub fn feed(prices: &[(&str, u64, u64)]) -> OraclePricePayload {
        let body: BTreeMap<_, _> = prices
            .iter()
            .map(|(a, p, t)| (a.to_string(), serde_json::json!({"price": p.to_string(), "expo": -8, "publish_time": t})))
            .collect();
        let payload = serde_json::to_string(&body).unwrap();
        let sig = signing_key().sign(payload.as_bytes());
        OraclePricePayload {
            payload,
            signature_b64: base64::engine::general_purpose::STANDARD.encode(sig.to_bytes()),
            public_key: pinned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::*;
    use super::*;

    #[test]
    fn accepts_good_feed_and_converts_to_micro_usd() {
        let f = verify_feed(&feed(&[("wrap.near", 428_000_000, 1000)]), &pinned(), 1010).unwrap();
        assert_eq!(f.price_micro_usd("wrap.near").unwrap(), 4_280_000);
        assert!(matches!(f.price_micro_usd("x"), Err(OracleError::MissingAsset(_))));
    }

    #[test]
    fn rejects_stale_feed() {
        assert_eq!(verify_feed(&feed(&[("a", 1, 1000)]), &pinned(), 1061), Err(OracleError::Stale));
        assert!(verify_feed(&feed(&[("a", 1, 1000)]), &pinned(), 1060).is_ok());
    }

    #[test]
    fn rejects_tampered_payload() {
        let mut f = feed(&[("a", 100, 1000)]);
        f.payload = f.payload.replace("100", "999");
        assert_eq!(verify_feed(&f, &pinned(), 1000), Err(OracleError::BadSignature));
    }

    #[test]
    fn rejects_feed_from_a_different_key() {
        let mut f = feed(&[("a", 100, 1000)]);
        f.public_key = format!("ed25519:{}", bs58::encode([9u8; 32]).into_string());
        assert_eq!(verify_feed(&f, &pinned(), 1000), Err(OracleError::WrongKey));
    }
}
