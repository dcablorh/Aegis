//! Builds the pieces for a dry-run end-to-end test on testnet. Prints one JSON object:
//!   policy_commitment_hash_hex, encrypted_payload_base64  -> for the vault's `register_policy`
//!   quote_json                                            -> the offline 1Click response for the AEGIS_QUOTE_JSON secret
//!
//! Usage: ENCLAVE_POLICY_PUB_HEX=<64 hex> [MAX_SLIPPAGE_BPS=100] cargo run -p aegis-wasi --example e2e_fixture
//!
//! The ephemeral key, nonce and salt come from the clock. That is fine for a test fixture and not for real policies.

use aegis_types::PolicyPlaintext;
use aegis_wasi::crypto::encrypt_policy;
use sha2::{Digest, Sha256};

fn entropy(tag: &str) -> [u8; 32] {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    Sha256::digest(format!("{tag}{nanos}{}", std::process::id()).as_bytes()).into()
}

fn main() {
    let pub_hex = std::env::var("ENCLAVE_POLICY_PUB_HEX").expect("set ENCLAVE_POLICY_PUB_HEX");
    let enclave_pub: [u8; 32] = hex::decode(pub_hex).unwrap().try_into().expect("32 bytes");
    let policy = PolicyPlaintext {
        hf_min_bps: 10_800,
        hf_target_bps: 12_500,
        max_slippage_bps: std::env::var("MAX_SLIPPAGE_BPS").ok().and_then(|v| v.parse().ok()).unwrap_or(35),
        salt_hex: hex::encode(&entropy("salt")[..8]),
    };
    let nonce: [u8; 12] = entropy("nonce")[..12].try_into().unwrap();
    let ciphertext = encrypt_policy(&policy, &enclave_pub, entropy("eph"), nonce);
    // A dry-run 1Click response: spread 10 bps (345.95 in vs 345.60 out), delivers the full 345.60 USDC.
    let quote = r#"{"correlationId":"e2e-dry-1","quoteRequest":{"dry":true},"quote":{"amountIn":"345950000","amountInUsd":"345.95","amountOut":"345600000","amountOutUsd":"345.60"}}"#;
    println!(
        "{}",
        serde_json::json!({
            "policy_commitment_hash_hex": hex::encode(policy.commitment_hash().unwrap()),
            "encrypted_payload_base64": ciphertext,
            "quote_json": quote,
        })
    );
}
