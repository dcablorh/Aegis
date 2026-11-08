import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, utf8 } from "./bytes.js";
import type { PolicyPlaintext } from "./index.js";

/** Layout matches `enclave/aegis-wasi`: pubkey || nonce || ChaCha20-Poly1305. */
export function encryptPolicy(
  policy: PolicyPlaintext,
  enclavePublicKey: Uint8Array,
  ephemeralSecret: Uint8Array,
  nonce: Uint8Array,
): string {
  if (enclavePublicKey.length !== 32 || ephemeralSecret.length !== 32 || nonce.length !== 12) {
    throw new Error("policy encryption expects a 32-byte key, 32-byte secret, and 12-byte nonce");
  }
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const shared = x25519.getSharedSecret(ephemeralSecret, enclavePublicKey);
  const key = sha256(concat([utf8("aegis-policy-key-v1"), shared, ephemeralPublic]));
  const plaintext = utf8(JSON.stringify({
    hf_min_bps: policy.hf_min_bps,
    hf_target_bps: policy.hf_target_bps,
    max_slippage_bps: policy.max_slippage_bps,
    salt_hex: policy.salt_hex,
  }));
  const sealed = chacha20poly1305(key, nonce).encrypt(plaintext);
  return btoa(String.fromCharCode(...concat([ephemeralPublic, nonce, sealed])));
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error("expected even-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
