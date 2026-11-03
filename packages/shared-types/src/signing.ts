import { createHash } from "node:crypto";
import type { EnclaveRescueDecision, RescueAction } from "./index.js";

/** Rust enum discriminants used by `EnclaveRescueDecision::signing_message`. */
export const RESCUE_ACTION_TAG: Record<RescueAction, number> = {
  NONE: 0,
  REPAY_DEBT: 1,
  ADD_COLLATERAL: 2,
  LOCAL_FALLBACK_SWAP: 3,
};

function u32be(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error("expected a u32");
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
}

function field(parts: Buffer[], bytes: Buffer): void {
  parts.push(u32be(bytes.length), bytes);
}

/**
 * SHA-256 over the fixed layout in `EnclaveRescueDecision::signing_message`.
 * Signature and attestation fields are not included. Returns 64 lowercase hex chars.
 */
export function signingMessageHex(decision: EnclaveRescueDecision): string {
  const tag = RESCUE_ACTION_TAG[decision.action];
  if (tag === undefined) {
    throw new Error(`unknown rescue action: ${decision.action}`);
  }
  const parts: Buffer[] = [Buffer.from("aegis-decision-v1")];
  field(parts, Buffer.from(decision.request_id));
  field(parts, Buffer.from(decision.account_id));
  parts.push(
    u32be(decision.observed_hf_bps),
    u32be(decision.trigger_hf_bps),
    u32be(decision.target_hf_bps),
    Buffer.from([tag]),
  );
  field(parts, Buffer.from(decision.repay_amount_raw));
  const quote = decision.oneclick_quote;
  if (quote === null) {
    parts.push(Buffer.from([0]));
  } else {
    parts.push(Buffer.from([1, quote.dry ? 1 : 0]));
    field(parts, Buffer.from(quote.quote_id));
    field(parts, Buffer.from(quote.deposit_address));
    field(parts, Buffer.from(quote.amount_in));
    field(parts, Buffer.from(quote.amount_out));
    parts.push(u32be(quote.solver_spread_bps), u32be(quote.liquidation_penalty_saved_bps));
  }
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
}
