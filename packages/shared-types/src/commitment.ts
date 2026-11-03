import { createHash } from "node:crypto";
import type { PolicyPlaintext } from "./index.js";

function u32be(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error("expected a u32");
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
}

function saltBytes(saltHex: string): Buffer {
  if (saltHex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(saltHex)) {
    throw new Error("salt_hex is not even-length hex");
  }
  return Buffer.from(saltHex, "hex");
}

/**
 * `sha256("aegis-policy-v1" || hf_min || hf_target || max_slippage || salt)`.
 * The three thresholds are big-endian u32. Returns 64 lowercase hex chars.
 * Matches `PolicyPlaintext::commitment_hash` in crates/aegis-types.
 */
export function commitmentHash(policy: PolicyPlaintext): string {
  const hash = createHash("sha256");
  hash.update("aegis-policy-v1");
  hash.update(u32be(policy.hf_min_bps));
  hash.update(u32be(policy.hf_target_bps));
  hash.update(u32be(policy.max_slippage_bps));
  hash.update(saltBytes(policy.salt_hex));
  return hash.digest("hex");
}
