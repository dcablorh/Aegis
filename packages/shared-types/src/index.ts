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

/** Cleartext policy. Client and enclave only. Never stored on the vault (Invariant 1). */
export interface PolicyPlaintext {
  hf_min_bps: number;
  hf_target_bps: number;
  max_slippage_bps: number;
  /** Hex blinding value. Stops guessing the small threshold space from the commitment. */
  salt_hex: string;
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

/** Signed price feed from price-oracle.near. `signature_b64` is Ed25519 over the raw `payload` bytes. */
export interface OraclePricePayload {
  payload: string;
  signature_b64: string;
  /** `ed25519:<base58>`. Must match the key pinned in the vault. */
  public_key: string;
}

export interface PositionAsset {
  token_id: string;
  amount_raw: string;
  decimals: number;
  /** Collateral or borrow weight in basis points (10000 = 1.0). */
  weight_bps: number;
}

export interface PositionSnapshot {
  collateral: PositionAsset[];
  borrowed: PositionAsset[];
}

/** stdin JSON of the enclave. `price_history` may be omitted on the wire (serde default: []). */
export interface EnclaveExecutionInput {
  request_id: string;
  account_id: AccountId;
  policy: EncryptedSolvencyPolicy;
  position: PositionSnapshot;
  price: OraclePricePayload;
  price_history?: OraclePricePayload[];
  /** Unix seconds taken from the contract block timestamp. */
  now_unix_s: number;
}

/** Externally tagged, SCREAMING_SNAKE_CASE, matching `aegis_types::RescueLock`. */
export type RescueLock =
  | "IDLE"
  | { IN_FLIGHT: { request_id: string } };

export interface ApprovedRescueTicket {
  ticket_id: string;
  decision: EnclaveRescueDecision;
  /** Nanoseconds. Values above 2^53 are not exact in JSON numbers. */
  created_at_ns: number;
}

/** Invariant 4: maximum oracle age, in nanoseconds. */
export const MAX_ORACLE_AGE_NS = 60_000_000_000;

/** Panic strings shared with the vault. */
export const errors = {
  UNAUTHORIZED_RECIPIENT: "ERR_UNAUTHORIZED_RECIPIENT",
  UNAUTHORIZED_KEEPER: "ERR_UNAUTHORIZED_KEEPER",
  RESCUE_IN_FLIGHT: "ERR_RESCUE_IN_FLIGHT",
  NO_LOCK_FOR_REQUEST: "ERR_NO_LOCK_FOR_REQUEST",
  STALE_ORACLE: "ERR_STALE_ORACLE",
  BAD_ORACLE_SIGNATURE: "ERR_BAD_ORACLE_SIGNATURE",
  BAD_ENCLAVE_SIGNATURE: "ERR_BAD_ENCLAVE_SIGNATURE",
} as const;

const NEXT: Record<IntentLifecycleState, IntentLifecycleState[]> = {
  PENDING_DEPOSIT: ["PROCESSING", "REFUNDED", "FAILED"],
  PROCESSING: ["SUCCESS", "REFUNDED", "FAILED"],
  SUCCESS: [], REFUNDED: [], FAILED: [],
};

export const isTerminal = (s: IntentLifecycleState) => NEXT[s].length === 0;
export const canTransition = (a: IntentLifecycleState, b: IntentLifecycleState) => NEXT[a].includes(b);

export { commitmentHash } from "./commitment.js";
export { RESCUE_ACTION_TAG, signingMessageHex } from "./signing.js";
