import test from "node:test";
import assert from "node:assert/strict";
import {
  QuoteError,
  buildNearDepositTransfer,
  checkQuote,
  fetch1ClickQuote,
  mapSwapStatus,
  parseUsdMicro,
  pollSwapStatus,
  quoteRequestBody,
  reduceStatus,
  type QuoteRequestParams,
} from "./index.js";

function sample(dry: boolean, amountInUsd: string, amountOut: string, deposit = true): unknown {
  return {
    correlationId: "corr-1",
    quoteRequest: { dry },
    quote: {
      ...(dry || !deposit ? {} : { depositAddress: "dep123" }),
      amountIn: "345950000",
      amountInUsd,
      amountOut,
      amountOutUsd: "345.60",
    },
  };
}

const request: QuoteRequestParams = {
  dry: true,
  swapType: "EXACT_OUTPUT",
  originAsset: "nep141:base-usdc.omft.near",
  destinationAsset: "nep141:usdc.near",
  amount: "345600000",
  recipient: "alice.near",
  recipientType: "DESTINATION_CHAIN",
  refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
  refundType: "ORIGIN_CHAIN",
  slippageTolerance: 50,
  depositType: "ORIGIN_CHAIN",
  deadline: "2026-11-14T23:59:00Z",
};

test("usd parsing matches the enclave", () => {
  assert.equal(parseUsdMicro("345.6"), 345_600_000n);
  assert.equal(parseUsdMicro("345.123456789"), 345_123_456n);
  assert.equal(parseUsdMicro("7"), 7_000_000n);
  assert.equal(parseUsdMicro("x"), null);
});

test("dry quote is checked and spread is computed", () => {
  const quote = checkQuote(sample(true, "345.95", "345600000"), true, 345_600_000n, 720);
  assert.equal(quote.dry, true);
  assert.equal(quote.deposit_address, "dry_run");
  assert.equal(quote.solver_spread_bps, 10);
  assert.equal(quote.liquidation_penalty_saved_bps, 720);
  assert.equal(quote.quote_id, "corr-1");
});

test("live quote needs a deposit address and the dry flag must match", () => {
  assert.throws(() => checkQuote(sample(true, "345.95", "345600000"), false, 1n, 0), QuoteError);
  const quote = checkQuote(sample(false, "345.95", "345600000"), false, 345_600_000n, 0);
  assert.equal(quote.deposit_address, "dep123");
});

test("short delivery is rejected", () => {
  assert.throws(() => checkQuote(sample(true, "345.95", "345599999"), true, 345_600_000n, 0), (error: unknown) => {
    return error instanceof QuoteError && error.code === "ShortDelivery";
  });
});

test("quote request body includes the required OpenAPI fields", () => {
  const body = quoteRequestBody(request);
  assert.equal(body.dry, true);
  assert.equal(body.swapType, "EXACT_OUTPUT");
  assert.equal(body.depositType, "ORIGIN_CHAIN");
  assert.equal(body.recipientType, "DESTINATION_CHAIN");
  assert.equal(body.refundType, "ORIGIN_CHAIN");
  assert.equal(body.deadline, "2026-11-14T23:59:00Z");
});

test("status extras map onto the five-state machine and illegal jumps throw", () => {
  assert.equal(mapSwapStatus("PENDING_DEPOSIT"), "PENDING_DEPOSIT");
  assert.equal(mapSwapStatus("KNOWN_DEPOSIT_TX"), "PROCESSING");
  assert.equal(mapSwapStatus("INCOMPLETE_DEPOSIT"), "PROCESSING");
  assert.equal(reduceStatus("PENDING_DEPOSIT", "PROCESSING"), "PROCESSING");
  assert.equal(reduceStatus("PROCESSING", "REFUNDED"), "REFUNDED");
  assert.equal(reduceStatus("PROCESSING", "FAILED"), "FAILED");
  assert.throws(() => reduceStatus("PENDING_DEPOSIT", "SUCCESS"), /ERR_BAD_STATE_TRANSITION/);
  assert.throws(() => mapSwapStatus("NOT_A_STATE"), /unknown 1Click status/);
});

test("poller reports each change and stops on a terminal state", async () => {
  const seen: string[] = [];
  const bodies = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "SUCCESS"];
  const quote = await pollSwapStatus({
    depositAddress: "dep123",
    maxAttempts: 5,
    intervalMs: 0,
    sleep: async () => {},
    onStatusChange: (state) => seen.push(state),
    fetch: async () => new Response(JSON.stringify({ status: bodies.shift() }), { status: 200 }),
  });
  assert.equal(quote, "SUCCESS");
  assert.deepEqual(seen, ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"]);
});

test("dry-run quotes cannot be polled or turned into a transfer", () => {
  assert.throws(() => buildNearDepositTransfer("usdc.near", "dry_run", "10"));
  assert.throws(() => buildNearDepositTransfer("usdc.near", "dep123", "0"));
});

test("deposit transfer is an unsigned ft_transfer with 1 yocto", () => {
  const tx = buildNearDepositTransfer("usdc.near", "dep123", "345950000", "111");
  assert.equal(tx.methodName, "ft_transfer");
  assert.equal(tx.receiverId, "usdc.near");
  assert.equal(tx.args.receiver_id, "dep123");
  assert.equal(tx.args.amount, "345950000");
  assert.equal(tx.args.memo, "111");
  assert.equal(tx.attachedDepositYocto, "1");
});

test("fetch sends the body and parses a dry response", async () => {
  let sent = "";
  const quote = await fetch1ClickQuote(request, {
    liquidationPenaltySavedBps: 720,
    apiKey: "test-key",
    fetch: async (_url, init) => {
      sent = String(init?.body);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-API-Key"), "test-key");
      return new Response(JSON.stringify(sample(true, "345.95", "345600000")), { status: 200 });
    },
  });
  assert.equal(JSON.parse(sent).amount, "345600000");
  assert.equal(quote.deposit_address, "dry_run");
  assert.equal(quote.solver_spread_bps, 10);
});
