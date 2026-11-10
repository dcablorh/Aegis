//! Testnet helper for the end-to-end run. Everything it prints is TEST DATA built from throwaway seeds.
//!
//! Env (64 hex chars each): SIGN_SEED_HEX (enclave Ed25519), POLICY_SEED_HEX (enclave X25519), ORACLE_SEED_HEX (test price oracle).
//!
//!   testnet_kit keys                         public keys derived from the three seeds
//!   testnet_kit policy                       register_policy args (ciphertext + commitment) for the enclave's X25519 key
//!   testnet_kit trigger <account_id>         trigger_solvency_check args: SIMULATED position snapshot + freshly signed price feed
//!   testnet_kit quote <deposit_address>      SIMULATED non-dry 1Click response (AEGIS_QUOTE_JSON secret). Not a real 1Click quote.
//!
//! Optional: DEBT_TOKEN (default usdc.fakes.testnet), MAX_SLIPPAGE_BPS (default 100).
//! The position is the documented example (1000 wNEAR at $4.28 vs 2400 USDC, health 1.07, repay 345.60 USDC).

use aegis_types::PolicyPlaintext;
use aegis_wasi::crypto::{enclave_public_key, encrypt_policy};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

fn seed(name: &str) -> [u8; 32] {
    hex::decode(std::env::var(name).unwrap_or_else(|_| panic!("set {name}")))
        .unwrap()
        .try_into()
        .expect("32 bytes")
}

fn entropy(tag: &str) -> [u8; 32] {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    Sha256::digest(format!("{tag}{nanos}{}", std::process::id()).as_bytes()).into()
}

fn oracle_pub_b58(k: &SigningKey) -> String {
    format!("ed25519:{}", bs58::encode(k.verifying_key().to_bytes()).into_string())
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
}

fn signed_feed(oracle: &SigningKey, debt_token: &str, publish_time: u64) -> serde_json::Value {
    let payload = serde_json::json!({
        "wrap.near": {"price": "428000000", "expo": -8, "publish_time": publish_time},
        debt_token: {"price": "100000000", "expo": -8, "publish_time": publish_time},
    })
    .to_string();
    let sig = base64::engine::general_purpose::STANDARD.encode(oracle.sign(payload.as_bytes()).to_bytes());
    serde_json::json!({"payload": payload, "signature_b64": sig, "public_key": oracle_pub_b58(oracle)})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let debt = std::env::var("DEBT_TOKEN").unwrap_or_else(|_| "usdc.fakes.testnet".into());
    match args.get(1).map(String::as_str) {
        Some("keys") => {
            let sign = SigningKey::from_bytes(&seed("SIGN_SEED_HEX"));
            let oracle = SigningKey::from_bytes(&seed("ORACLE_SEED_HEX"));
            println!(
                "{}",
                serde_json::json!({
                    "enclave_ed25519_pub_hex": hex::encode(sign.verifying_key().to_bytes()),
                    "enclave_x25519_pub_hex": hex::encode(enclave_public_key(seed("POLICY_SEED_HEX"))),
                    "oracle_pub_b58": oracle_pub_b58(&oracle),
                })
            );
        }
        Some("policy") => {
            let policy = PolicyPlaintext {
                hf_min_bps: 10_800,
                hf_target_bps: 12_500,
                max_slippage_bps: std::env::var("MAX_SLIPPAGE_BPS").ok().and_then(|v| v.parse().ok()).unwrap_or(100),
                salt_hex: hex::encode(&entropy("salt")[..8]),
            };
            let nonce: [u8; 12] = entropy("nonce")[..12].try_into().unwrap();
            let ct = encrypt_policy(&policy, &enclave_public_key(seed("POLICY_SEED_HEX")), entropy("eph"), nonce);
            println!(
                "{}",
                serde_json::json!({
                    "policy_commitment_hash_hex": hex::encode(policy.commitment_hash().unwrap()),
                    "encrypted_payload_base64": ct,
                    "allowed_origin_assets": [format!("nep141:{debt}")],
                    "target_repay_asset": format!("nep141:{debt}"),
                })
            );
        }
        Some("trigger") => {
            let account = args.get(2).expect("account_id");
            let oracle = SigningKey::from_bytes(&seed("ORACLE_SEED_HEX"));
            let t = now();
            println!(
                "{}",
                serde_json::json!({
                    "account_id": account,
                    "position": {
                        "collateral": [{"token_id": "wrap.near", "amount_raw": "1000000000000000000000000000", "decimals": 24, "weight_bps": 6000}],
                        "borrowed": [{"token_id": debt, "amount_raw": "2400000000", "decimals": 6, "weight_bps": 10000}],
                    },
                    "price": signed_feed(&oracle, &debt, t),
                    "price_history": [],
                })
            );
        }
        Some("quote") => {
            let dep = args.get(2).expect("deposit address");
            println!(
                "{}",
                serde_json::json!({
                    "correlationId": "SIMULATED-testnet-non-dry-1",
                    "quoteRequest": {"dry": false},
                    "quote": {
                        "depositAddress": dep,
                        "amountIn": "345950000", "minAmountIn": "345950000", "amountInUsd": "345.95",
                        "amountOut": "345600000", "amountOutUsd": "345.60",
                    },
                })
            );
        }
        _ => eprintln!("usage: testnet_kit keys | policy | trigger <account> | quote <deposit_address>"),
    }
}
