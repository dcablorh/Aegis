import { canTransition, type IntentLifecycleState } from "@aegis/shared-types";

/** GET /v0/status. Query: depositAddress, optional depositMemo. */
export const STATUS_URL = "https://1click.chaindefuser.com/v0/status";

/**
 * API states that are not in the vault enum, mapped onto the five-state machine.
 * KNOWN_DEPOSIT_TX and INCOMPLETE_DEPOSIT both mean the swap has left "waiting for deposit".
 */
const STATUS_MAP: Record<string, IntentLifecycleState> = {
  PENDING_DEPOSIT: "PENDING_DEPOSIT",
  KNOWN_DEPOSIT_TX: "PROCESSING",
  INCOMPLETE_DEPOSIT: "PROCESSING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  REFUNDED: "REFUNDED",
  FAILED: "FAILED",
};

export function mapSwapStatus(raw: string): IntentLifecycleState {
  const mapped = STATUS_MAP[raw];
  if (!mapped) throw new Error(`unknown 1Click status: ${raw}`);
  return mapped;
}

/** First observation is accepted. Later steps must follow the vault transition rules. */
export function reduceStatus(current: IntentLifecycleState | null, raw: string): IntentLifecycleState {
  const next = mapSwapStatus(raw);
  if (current === null || current === next) return next;
  if (!canTransition(current, next)) {
    throw new Error(`ERR_BAD_STATE_TRANSITION: ${current} -> ${next} (${raw})`);
  }
  return next;
}

export interface StatusPollOptions {
  depositAddress: string;
  depositMemo?: string;
  fetch?: typeof fetch;
  apiKey?: string;
  jwt?: string;
  intervalMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onStatusChange?: (state: IntentLifecycleState, raw: string) => void;
}

function envValue(name: string): string | undefined {
  if (typeof process === "undefined" || process.env === undefined) return undefined;
  return process.env[name];
}

function authHeaders(options: StatusPollOptions): Record<string, string> {
  const apiKey = options.apiKey ?? envValue("ONECLICK_API_KEY");
  const jwt = options.jwt ?? envValue("ONECLICK_JWT");
  if (apiKey) return { "X-API-Key": apiKey };
  if (jwt) return { Authorization: `Bearer ${jwt}` };
  return {};
}

export async function fetchSwapStatus(options: StatusPollOptions): Promise<{ raw: string; state: IntentLifecycleState }> {
  if (!options.depositAddress || options.depositAddress === "dry_run") {
    throw new Error("dry-run quotes have no deposit address to track");
  }
  const url = new URL(STATUS_URL);
  url.searchParams.set("depositAddress", options.depositAddress);
  if (options.depositMemo) url.searchParams.set("depositMemo", options.depositMemo);
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(url, { headers: authHeaders(options) });
  const text = await response.text();
  if (!response.ok) throw new Error(`1Click status failed: ${response.status} ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { status?: string };
  if (!body.status) throw new Error("1Click status response has no status");
  return { raw: body.status, state: mapSwapStatus(body.status) };
}

/** Polls until SUCCESS, REFUNDED, or FAILED, or until maxAttempts. */
export async function pollSwapStatus(options: StatusPollOptions): Promise<IntentLifecycleState> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 30;
  const intervalMs = options.intervalMs ?? 2000;
  let current: IntentLifecycleState | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { raw, state } = await fetchSwapStatus(options);
    const next = reduceStatus(current, raw);
    if (next !== current) options.onStatusChange?.(next, raw);
    current = next;
    if (current === "SUCCESS" || current === "REFUNDED" || current === "FAILED") return current;
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  if (current === null) throw new Error("1Click status poll made no observations");
  return current;
}
