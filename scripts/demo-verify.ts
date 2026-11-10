import { fetch1ClickQuote } from "../packages/intents-client/dist/index.js";
import {
  BURROW_TESTNET,
  RPC_TESTNET,
  getAccount,
  health,
  penaltySavedBps,
  repayUsdMicro,
  viewFunction,
} from "../packages/rhea-client/dist/index.js";

const VAULT = "vault.aegis-cloud-319903.testnet";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

console.log("AegisMargin verification");

const account = await getAccount(BURROW_TESTNET, "position1.aegis-cloud-319903.testnet", { rpcUrl: RPC_TESTNET });
if (!account) fail("Burrow did not return the sample testnet account.");
console.log(`Live Burrow account ${account.account_id}: collateral ${account.collateral.length}, debt ${account.borrowed.length}.`);
console.log("Testnet oracle prices are not used here. Health below is the documented example, not this account.");

const position = health(
  [{ amount_raw: "1000000000000000000000000000", decimals: 24, weight_bps: 6000, price_micro_usd: 4_280_000n }],
  [{ amount_raw: "2400000000", decimals: 6, weight_bps: 10000, price_micro_usd: 1_000_000n }],
);
if (position.hf_bps !== 10_700n) fail(`documented health was ${position.hf_bps}, expected 10700`);
const repay = repayUsdMicro(position, 12_500, 10_000);
if (repay !== 345_600_000n) fail(`documented repayment was ${repay}, expected 345600000`);
console.log(`Documented example: health 1.07, repay 345.60 USDC, penalty saved ${penaltySavedBps(position.hf_bps)} bps.`);

const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const quote = await fetch1ClickQuote({
  dry: true,
  swapType: "EXACT_OUTPUT",
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amount: "345600000",
  recipient: "intents.near",
  recipientType: "DESTINATION_CHAIN",
  refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
  refundType: "ORIGIN_CHAIN",
  slippageTolerance: 100,
  depositType: "ORIGIN_CHAIN",
  deadline,
}, { liquidationPenaltySavedBps: 720 });
if (!quote.dry || quote.deposit_address !== "dry_run") fail("quote was not a dry run");
console.log(`LIVE 1CLICK DRY-RUN QUOTE ${quote.quote_id}: expected ${quote.solver_spread_bps} bps, worst case ${quote.worst_case_spread_bps} bps. No settlement.`);

const allowed = await viewFunction<boolean>(
  VAULT,
  "is_recipient_allowed",
  { account_id: "borrower1.aegis-cloud-319903.testnet", recipient: "evil.near" },
  { rpcUrl: RPC_TESTNET },
);
if (allowed !== false) fail("evil.near was not blocked");
console.log("Allowlist: evil.near is blocked for borrower1.aegis-cloud-319903.testnet.");
console.log("Verification finished.");
