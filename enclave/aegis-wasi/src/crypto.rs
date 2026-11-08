#![allow(deprecated)] // chacha20poly1305 0.10 still uses generic-array 0.14 constructors
//! Policy encryption (borrower -> enclave) and decision signing (enclave -> vault).
//!
//! Policy ciphertext layout (base64): `ephemeral_x25519_pub (32) || nonce (12) || ChaCha20-Poly1305(PolicyPlaintext JSON)`.
//! Key = sha256("aegis-policy-key-v1" || shared_secret || ephemeral_pub).

use aegis_types::{EnclaveRescueDecision, PolicyPlaintext};
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Debug, PartialEq, Eq)]
pub enum CryptoError {
    BadCiphertext,
    DecryptFailed,
    BadPolicy,
    /// Opened policy does not hash to the on-chain commitment.
    CommitmentMismatch,
}

fn derive_key(shared: &[u8; 32], eph_pub: &[u8; 32]) -> Key {
    let mut h = Sha256::new();
    h.update(b"aegis-policy-key-v1");
    h.update(shared);
    h.update(eph_pub);
    Key::clone_from_slice(&h.finalize())
}

/// Used by the web app and tests to produce the on-chain ciphertext.
pub fn encrypt_policy(
    policy: &PolicyPlaintext,
    enclave_pub: &[u8; 32],
    eph_secret: [u8; 32],
    nonce: [u8; 12],
) -> String {
    let eph = StaticSecret::from(eph_secret);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(*enclave_pub));
    let key = derive_key(shared.as_bytes(), &eph_pub);
    let ct = ChaCha20Poly1305::new(&key)
        .encrypt(Nonce::from_slice(&nonce), serde_json::to_vec(policy).unwrap().as_slice())
        .expect("encrypt");
    let mut out = Vec::with_capacity(44 + ct.len());
    out.extend_from_slice(&eph_pub);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    B64.encode(out)
}

/// Opens the ciphertext and checks it against the public commitment, so a swapped ciphertext is caught.
pub fn decrypt_policy(
    payload_b64: &str,
    enclave_secret: [u8; 32],
    commitment: &[u8; 32],
) -> Result<PolicyPlaintext, CryptoError> {
    let raw = B64.decode(payload_b64).map_err(|_| CryptoError::BadCiphertext)?;
    if raw.len() < 32 + 12 + 16 {
        return Err(CryptoError::BadCiphertext);
    }
    let eph_pub: [u8; 32] = raw[..32].try_into().unwrap();
    let shared = StaticSecret::from(enclave_secret).diffie_hellman(&PublicKey::from(eph_pub));
    let pt = ChaCha20Poly1305::new(&derive_key(shared.as_bytes(), &eph_pub))
        .decrypt(Nonce::from_slice(&raw[32..44]), &raw[44..])
        .map_err(|_| CryptoError::DecryptFailed)?;
    let policy: PolicyPlaintext = serde_json::from_slice(&pt).map_err(|_| CryptoError::BadPolicy)?;
    let hash = policy.commitment_hash().map_err(|_| CryptoError::BadPolicy)?;
    if &hash != commitment {
        return Err(CryptoError::CommitmentMismatch);
    }
    Ok(policy)
}

pub fn enclave_public_key(secret: [u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(secret)).to_bytes()
}

/// Fills `enclave_signature_hex` with an Ed25519 signature over `decision.signing_message()`.
pub fn sign_decision(decision: &mut EnclaveRescueDecision, key: &SigningKey) {
    decision.enclave_signature_hex = hex::encode(key.sign(&decision.signing_message()).to_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    fn policy() -> PolicyPlaintext {
        PolicyPlaintext { hf_min_bps: 10800, hf_target_bps: 12500, max_slippage_bps: 35, salt_hex: "a1b2c3".into() }
    }

    #[test]
    fn policy_roundtrips_and_matches_commitment() {
        let secret = [3u8; 32];
        let ct = encrypt_policy(&policy(), &enclave_public_key(secret), [5u8; 32], [1u8; 12]);
        let commit = policy().commitment_hash().unwrap();
        assert_eq!(decrypt_policy(&ct, secret, &commit).unwrap(), policy());
    }

    #[test]
    fn wrong_key_or_commitment_is_rejected() {
        let ct = encrypt_policy(&policy(), &enclave_public_key([3u8; 32]), [5u8; 32], [1u8; 12]);
        let commit = policy().commitment_hash().unwrap();
        assert_eq!(decrypt_policy(&ct, [4u8; 32], &commit), Err(CryptoError::DecryptFailed));
        assert_eq!(decrypt_policy(&ct, [3u8; 32], &[0u8; 32]), Err(CryptoError::CommitmentMismatch));
        assert_eq!(decrypt_policy("AAAA", [3u8; 32], &commit), Err(CryptoError::BadCiphertext));
    }

    #[test]
    fn ciphertext_does_not_contain_plaintext() {
        let ct = encrypt_policy(&policy(), &enclave_public_key([3u8; 32]), [5u8; 32], [1u8; 12]);
        assert!(!ct.contains("hf_min") && !ct.contains("10800"));
    }

    #[test]
    fn decision_signature_verifies() {
        let key = SigningKey::from_bytes(&[8u8; 32]);
        let mut d: EnclaveRescueDecision = serde_json::from_str(
            r#"{"request_id":"r","account_id":"a.near","observed_hf_bps":1,"trigger_hf_bps":2,"target_hf_bps":3,"action":"NONE","repay_amount_raw":"0","oneclick_quote":null,"enclave_signature_hex":"","attestation_sha256":""}"#,
        )
        .unwrap();
        sign_decision(&mut d, &key);
        let sig = Signature::from_slice(&hex::decode(&d.enclave_signature_hex).unwrap()).unwrap();
        assert!(key.verifying_key().verify(&d.signing_message(), &sig).is_ok());
    }
}
