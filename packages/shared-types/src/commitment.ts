import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { concat, u32be, utf8 } from "./bytes.js";
import type { PolicyPlaintext } from "./index.js";

function saltBytes(saltHex: string): Uint8Array {
  if (saltHex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(saltHex)) {
    throw new Error("salt_hex is not even-length hex");
  }
  const out = new Uint8Array(saltHex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(saltHex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * `sha256("aegis-policy-v1" || hf_min || hf_target || max_slippage || salt)`.
 * The three thresholds are big-endian u32. Returns 64 lowercase hex chars.
 * Matches `PolicyPlaintext::commitment_hash` in crates/aegis-types.
 */
export function commitmentHash(policy: PolicyPlaintext): string {
  return bytesToHex(sha256(concat([
    utf8("aegis-policy-v1"),
    u32be(policy.hf_min_bps),
    u32be(policy.hf_target_bps),
    u32be(policy.max_slippage_bps),
    saltBytes(policy.salt_hex),
  ])));
}
