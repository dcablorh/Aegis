import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { EnclaveRescueDecision, RescueAction } from "./index.js";
import { concat, u32be, utf8 } from "./bytes.js";

/** Rust enum discriminants used by `EnclaveRescueDecision::signing_message`. */
export const RESCUE_ACTION_TAG: Record<RescueAction, number> = {
  NONE: 0,
  REPAY_DEBT: 1,
  ADD_COLLATERAL: 2,
  LOCAL_FALLBACK_SWAP: 3,
};

function field(parts: Uint8Array[], bytes: Uint8Array): void {
  parts.push(u32be(bytes.length), bytes);
}

/**
 * SHA-256 over the fixed layout in `EnclaveRescueDecision::signing_message`.
 * Signature and attestation fields are not included. Returns 64 lowercase hex chars.
 */
export function signingMessageHex(decision: EnclaveRescueDecision): string {
  const tag = RESCUE_ACTION_TAG[decision.action];
  if (tag === undefined) throw new Error(`unknown rescue action: ${decision.action}`);
  const parts: Uint8Array[] = [utf8("aegis-decision-v1")];
  field(parts, utf8(decision.request_id));
  field(parts, utf8(decision.account_id));
  parts.push(u32be(decision.observed_hf_bps), u32be(decision.trigger_hf_bps), u32be(decision.target_hf_bps), new Uint8Array([tag]));
  field(parts, utf8(decision.repay_amount_raw));
  const quote = decision.oneclick_quote;
  if (quote === null) {
    parts.push(new Uint8Array([0]));
  } else {
    parts.push(new Uint8Array([1, quote.dry ? 1 : 0]));
    field(parts, utf8(quote.quote_id));
    field(parts, utf8(quote.deposit_address));
    field(parts, utf8(quote.amount_in));
    field(parts, utf8(quote.amount_out));
    parts.push(u32be(quote.solver_spread_bps), u32be(quote.liquidation_penalty_saved_bps));
  }
  return bytesToHex(sha256(concat(parts)));
}
