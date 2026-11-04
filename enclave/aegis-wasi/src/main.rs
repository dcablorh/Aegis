//! OutLayer entry point. Reads `EnclaveExecutionInput` JSON from stdin, prints the signed decision JSON to stdout.
//!
//! Environment (OutLayer secrets):
//!   AEGIS_POLICY_SECRET_HEX     32-byte X25519 secret that opens borrower policies
//!   AEGIS_SIGNING_KEY_HEX       32-byte Ed25519 seed that signs decisions
//!   AEGIS_ORACLE_PUBKEY         pinned `ed25519:...` key of price-oracle
//!   AEGIS_ATTESTATION_SHA256    sha256 of this wasm binary
//!   AEGIS_RECIPIENT, AEGIS_REFUND_TO
//!   AEGIS_LIVE=1                request a real (non-dry) 1Click quote
//!   AEGIS_QUOTE_JSON=<json>     offline run: the 1Click response itself (works as an OutLayer secret)
//!   AEGIS_QUOTE_FIXTURE=<path>  offline run: read the 1Click response from a file
//!
//! Live 1Click HTTP from inside the sandbox is not wired yet: without AEGIS_QUOTE_JSON or AEGIS_QUOTE_FIXTURE the run fails loudly.

use aegis_types::EnclaveExecutionInput;
use aegis_wasi::quote::{FixtureQuote, QuoteRequest, QuoteSource};
use aegis_wasi::{decide, EnclaveConfig};
use ed25519_dalek::SigningKey;
use std::io::Read;

struct NoNetwork;

impl QuoteSource for NoNetwork {
    fn fetch(&self, _: &QuoteRequest) -> Result<String, String> {
        Err("live 1Click HTTP is not wired yet; set AEGIS_QUOTE_JSON or AEGIS_QUOTE_FIXTURE for an offline run".into())
    }
}

fn env(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("missing env {name}"))
}

fn key32(name: &str) -> Result<[u8; 32], String> {
    hex::decode(env(name)?)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| format!("{name} must be 64 hex chars"))
}

fn run() -> Result<String, String> {
    let mut stdin = String::new();
    std::io::stdin().read_to_string(&mut stdin).map_err(|e| e.to_string())?;
    let input: EnclaveExecutionInput = serde_json::from_str(&stdin).map_err(|e| format!("bad input: {e}"))?;
    let cfg = EnclaveConfig {
        policy_secret: key32("AEGIS_POLICY_SECRET_HEX")?,
        signing_key: SigningKey::from_bytes(&key32("AEGIS_SIGNING_KEY_HEX")?),
        oracle_pubkey: env("AEGIS_ORACLE_PUBKEY")?,
        attestation_sha256: env("AEGIS_ATTESTATION_SHA256").unwrap_or_else(|_| "unattested-local".into()),
        recipient: env("AEGIS_RECIPIENT")?,
        refund_to: env("AEGIS_REFUND_TO")?,
        live: std::env::var("AEGIS_LIVE").is_ok_and(|v| v == "1"),
    };
    let source: Box<dyn QuoteSource> = if let Ok(json) = std::env::var("AEGIS_QUOTE_JSON") {
        Box::new(FixtureQuote(json))
    } else if let Ok(path) = std::env::var("AEGIS_QUOTE_FIXTURE") {
        Box::new(FixtureQuote(std::fs::read_to_string(path).map_err(|e| e.to_string())?))
    } else {
        Box::new(NoNetwork)
    };
    let (decision, reason) = decide(&input, &cfg, source.as_ref()).map_err(|e| format!("{e:?}"))?;
    eprintln!("aegis-wasi: {reason:?}");
    serde_json::to_string(&decision).map_err(|e| e.to_string())
}

fn main() {
    match run() {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("aegis-wasi error: {e}");
            std::process::exit(1);
        }
    }
}
