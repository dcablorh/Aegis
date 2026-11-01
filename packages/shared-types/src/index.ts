// Field-for-field mirror of crates/aegis-types (JSON wire format). Change both together.

export type AccountId = string;

export interface EncryptedSolvencyPolicy {
  owner_id: AccountId;
  /** 64 lowercase hex chars (SHA-256 commitment). */
  policy_commitment_hash: string;
  encrypted_payload_base64: string;
  allowed_origin_assets: string[];
  target_repay_asset: string;
}

export type RescueAction = "NONE" | "REPAY_DEBT" | "ADD_COLLATERAL" | "LOCAL_FALLBACK_SWAP";

export interface OneClickQuotePayload {
  quote_id: string;
  dry: boolean;
  deposit_address: string;
  amount_in: string;
  amount_out: string;
  solver_spread_bps: number;
  liquidation_penalty_saved_bps: number;
}

export interface EnclaveRescueDecision {
  request_id: string;
  account_id: AccountId;
  observed_hf_bps: number;
  trigger_hf_bps: number;
  target_hf_bps: number;
  action: RescueAction;
  repay_amount_raw: string;
  oneclick_quote: OneClickQuotePayload | null;
  enclave_signature_hex: string;
  attestation_sha256: string;
}

export type IntentLifecycleState =
  | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

const NEXT: Record<IntentLifecycleState, IntentLifecycleState[]> = {
  PENDING_DEPOSIT: ["PROCESSING", "REFUNDED", "FAILED"],
  PROCESSING: ["SUCCESS", "REFUNDED", "FAILED"],
  SUCCESS: [], REFUNDED: [], FAILED: [],
};

export const isTerminal = (s: IntentLifecycleState) => NEXT[s].length === 0;
export const canTransition = (a: IntentLifecycleState, b: IntentLifecycleState) => NEXT[a].includes(b);
