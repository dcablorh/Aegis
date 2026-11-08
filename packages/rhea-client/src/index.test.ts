import test from "node:test";
import assert from "node:assert/strict";
import {
  getAccount,
  health,
  liquidationDiscountBps,
  penaltySavedBps,
  priceToMicroUsd,
  repayUsdMicro,
  viewFunction,
} from "./index.js";

test("health and repayment match the enclave doc example", () => {
  const position = health(
    [{ amount_raw: "1000000000000000000000000000", decimals: 24, weight_bps: 6000, price_micro_usd: 4_280_000n }],
    [{ amount_raw: "2400000000", decimals: 6, weight_bps: 10000, price_micro_usd: 1_000_000n }],
  );
  assert.equal(position.collateral_adj_usd, 2_568_000_000n);
  assert.equal(position.borrow_adj_usd, 2_400_000_000n);
  assert.equal(position.hf_bps, 10_700n);
  assert.equal(repayUsdMicro(position, 12_500, 10_000), 345_600_000n);
  assert.equal(liquidationDiscountBps(8_800n), 600n);
  assert.equal(liquidationDiscountBps(10_700n), 0n);
  assert.equal(penaltySavedBps(10_700n), 720n);
});

test("no debt is reported instead of an infinite health factor", () => {
  assert.throws(
    () => health(
      [{ amount_raw: "1", decimals: 0, weight_bps: 10000, price_micro_usd: 1_000_000n }],
      [],
    ),
    /no debt/,
  );
});

test("oracle multiplier converts to micro-USD", () => {
  assert.equal(priceToMicroUsd({ multiplier: "428000000", decimals: 8 }), 4_280_000n);
  assert.equal(priceToMicroUsd({ multiplier: "100000000", decimals: 8 }), 1_000_000n);
});

test("view calls decode Burrow JSON", async () => {
  const account = await getAccount("contract.1638481328.burrow.testnet", "alice.testnet", {
    rpcUrl: "https://rpc.testnet.near.org",
    fetch: async (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.params.method_name, "get_account");
      assert.equal(sent.params.account_id, "contract.1638481328.burrow.testnet");
      const payload = JSON.stringify({
        account_id: "alice.testnet",
        supplied: [],
        collateral: [{ token_id: "usdc.fakes.testnet", balance: "600" }],
        borrowed: [],
      });
      return new Response(JSON.stringify({ result: { result: [...Buffer.from(payload)] } }));
    },
  });
  assert.equal(account?.collateral[0]?.balance, "600");
  await assert.rejects(
    () => viewFunction("x", "nope", {}, {
      rpcUrl: "https://rpc.testnet.near.org",
      fetch: async () => new Response(JSON.stringify({ result: { error: "MethodNotFound" } })),
    }),
    /MethodNotFound/,
  );
});
