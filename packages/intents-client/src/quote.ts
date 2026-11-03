import type { OneClickQuotePayload } from "@aegis/shared-types";

/** Live mainnet quote endpoint. There is no 1Click testnet. */
export const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";
export type ChainEndpoint = "ORIGIN_CHAIN" | "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

/**
 * Body of POST /v0/quote. Field names and required set follow the OpenAPI
 * QuoteRequest (docs.near-intents.org, 1Click API 0.1.10).
 */
export interface QuoteRequestParams {
  dry: boolean;
  swapType: SwapType;
  originAsset: string;
  destinationAsset: string;
  /** Integer smallest-unit amount. EXACT_OUTPUT means this is the output. */
  amount: string;
  recipient: string;
  recipientType: Exclude<ChainEndpoint, "ORIGIN_CHAIN">;
  refundTo: string;
  refundType: Exclude<ChainEndpoint, "DESTINATION_CHAIN">;
  /** Basis points. 100 = 1%. */
  slippageTolerance: number;
  depositType: Exclude<ChainEndpoint, "DESTINATION_CHAIN">;
  /** ISO-8601. Required by the API. */
  deadline: string;
  depositMode?: "SIMPLE" | "MEMO";
}

export interface QuoteClientOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  jwt?: string;
  /**
   * Penalty the rescue avoids, in bps. The quote API does not return this.
   * The enclave computes it. Defaults to 0, which means "not supplied".
   */
  liquidationPenaltySavedBps?: number;
}

export type QuoteErrorCode =
  | "BadJson"
  | "DryMismatch"
  | "MissingDepositAddress"
  | "BadAmount"
  | "ShortDelivery"
  | "Http";

export class QuoteError extends Error {
  constructor(readonly code: QuoteErrorCode, message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

interface RawQuoteResponse {
  correlationId?: string;
  quoteRequest?: { dry?: boolean };
  quote?: {
    depositAddress?: string | null;
    amountIn?: string;
    amountInUsd?: string;
    amountOut?: string;
    amountOutUsd?: string;
  };
}

/** "345.95" -> 345_950_000 micro-USD. Same truncation as the enclave. */
export function parseUsdMicro(value: string): bigint | null {
  const [whole, frac = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || (frac !== "" && !/^\d+$/.test(frac))) return null;
  const frac6 = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(frac6);
}

function spreadBps(usdIn: bigint, usdOut: bigint): number {
  if (usdOut === 0n) throw new QuoteError("BadAmount", "amountOutUsd is zero");
  const gap = usdIn > usdOut ? usdIn - usdOut : 0n;
  const spread = (gap * 10_000n) / usdOut;
  const cap = BigInt(0xffffffff);
  return Number(spread > cap ? cap : spread);
}

/**
 * Turns a raw 1Click body into the vault payload. `needOutRaw` is the minimum
 * destination amount (0 skips the short-delivery check).
 */
export function checkQuote(
  raw: unknown,
  expectDry: boolean,
  needOutRaw: bigint,
  penaltySavedBps: number,
): OneClickQuotePayload {
  if (typeof raw !== "object" || raw === null) throw new QuoteError("BadJson", "quote response is not an object");
  const body = raw as RawQuoteResponse;
  if (typeof body.correlationId !== "string" || !body.quote || !body.quoteRequest) {
    throw new QuoteError("BadJson", "quote response is missing correlationId, quoteRequest, or quote");
  }
  if (body.quoteRequest.dry !== expectDry) throw new QuoteError("DryMismatch", "quote dry flag does not match the request");
  const deposit = body.quote.depositAddress;
  let depositAddress: string;
  if (!expectDry) {
    if (!deposit) throw new QuoteError("MissingDepositAddress", "live quote has no deposit address");
    depositAddress = deposit;
  } else {
    depositAddress = "dry_run";
  }
  const amountIn = body.quote.amountIn;
  const amountOut = body.quote.amountOut;
  const amountInUsd = body.quote.amountInUsd;
  const amountOutUsd = body.quote.amountOutUsd;
  if (!amountIn || !amountOut || !/^\d+$/.test(amountIn) || !/^\d+$/.test(amountOut)) {
    throw new QuoteError("BadAmount", "amountIn or amountOut is not an integer string");
  }
  if (BigInt(amountOut) < needOutRaw) throw new QuoteError("ShortDelivery", "solver output is below the amount requested");
  if (!amountInUsd || !amountOutUsd) throw new QuoteError("BadAmount", "USD amounts are missing");
  const usdIn = parseUsdMicro(amountInUsd);
  const usdOut = parseUsdMicro(amountOutUsd);
  if (usdIn === null || usdOut === null) throw new QuoteError("BadAmount", "USD amounts are not decimal strings");
  return {
    quote_id: body.correlationId,
    dry: expectDry,
    deposit_address: depositAddress,
    amount_in: amountIn,
    amount_out: amountOut,
    solver_spread_bps: spreadBps(usdIn, usdOut),
    liquidation_penalty_saved_bps: penaltySavedBps,
  };
}

function authHeaders(options: QuoteClientOptions): Record<string, string> {
  const apiKey = options.apiKey ?? process.env.ONECLICK_API_KEY;
  const jwt = options.jwt ?? process.env.ONECLICK_JWT;
  if (apiKey) return { "X-API-Key": apiKey };
  if (jwt) return { Authorization: `Bearer ${jwt}` };
  return {};
}

export function quoteRequestBody(params: QuoteRequestParams): Record<string, unknown> {
  if (!/^\d+$/.test(params.amount)) throw new QuoteError("BadAmount", "amount must be an integer string");
  if (!params.deadline) throw new QuoteError("BadAmount", "deadline is required");
  return {
    dry: params.dry,
    swapType: params.swapType,
    slippageTolerance: params.slippageTolerance,
    originAsset: params.originAsset,
    depositType: params.depositType,
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    refundTo: params.refundTo,
    refundType: params.refundType,
    recipient: params.recipient,
    recipientType: params.recipientType,
    deadline: params.deadline,
    ...(params.depositMode ? { depositMode: params.depositMode } : {}),
  };
}

/** POST /v0/quote. A `dry: true` result is a live price, not a settlement. */
export async function fetch1ClickQuote(
  params: QuoteRequestParams,
  options: QuoteClientOptions = {},
): Promise<OneClickQuotePayload> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(QUOTE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(options) },
    body: JSON.stringify(quoteRequestBody(params)),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new QuoteError("Http", `1Click quote failed: ${response.status} ${text.slice(0, 300)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new QuoteError("BadJson", "1Click quote body is not JSON");
  }
  const needOut = params.swapType === "EXACT_OUTPUT" ? BigInt(params.amount) : 0n;
  return checkQuote(parsed, params.dry, needOut, options.liquidationPenaltySavedBps ?? 0);
}
