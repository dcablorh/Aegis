//! Invariant 4: the vault itself checks that a price feed is signed by the pinned oracle key and fresh.

use aegis_types::{errors, OraclePricePayload, MAX_ORACLE_AGE_NS};
use base64::Engine;
use near_sdk::{bs58, env, serde_json, AccountId};
use std::collections::BTreeMap;

use crate::AegisVault;

#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Entry {
    publish_time: u64,
}

fn decode_key(pinned: &str) -> Option<[u8; 32]> {
    bs58::decode(pinned.strip_prefix("ed25519:").unwrap_or(pinned)).into_vec().ok()?.try_into().ok()
}

impl AegisVault {
    /// Panics with a stable error code if the feed is not from the pinned key, tampered with, or too old.
    pub(crate) fn assert_valid_oracle_payload(&self, feed: &OraclePricePayload) {
        let pinned = decode_key(&self.oracle_public_key).unwrap_or_else(|| env::panic_str("ERR_BAD_PINNED_ORACLE_KEY"));
        if decode_key(&feed.public_key) != Some(pinned) {
            env::panic_str(errors::BAD_ORACLE_SIGNATURE);
        }
        let sig: [u8; 64] = base64::engine::general_purpose::STANDARD
            .decode(&feed.signature_b64)
            .ok()
            .and_then(|b| b.try_into().ok())
            .unwrap_or_else(|| env::panic_str(errors::BAD_ORACLE_SIGNATURE));
        if !env::ed25519_verify(&sig, feed.payload.as_bytes(), &pinned) {
            env::panic_str(errors::BAD_ORACLE_SIGNATURE);
        }
        let entries: BTreeMap<String, Entry> =
            serde_json::from_str(&feed.payload).unwrap_or_else(|_| env::panic_str("ERR_BAD_ORACLE_PAYLOAD"));
        if entries.is_empty() {
            env::panic_str("ERR_BAD_ORACLE_PAYLOAD");
        }
        let now = env::block_timestamp();
        for e in entries.values() {
            let t = e.publish_time.saturating_mul(1_000_000_000);
            if now.saturating_sub(t) > MAX_ORACLE_AGE_NS {
                env::panic_str(errors::STALE_ORACLE);
            }
        }
    }
}

/// Convenience used by tests and the rescue module.
pub(crate) fn token_account_of(asset: &str) -> Option<AccountId> {
    asset.strip_prefix("nep141:").unwrap_or(asset).parse().ok()
}
