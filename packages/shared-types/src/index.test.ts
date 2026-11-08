import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  commitmentHash,
  encryptPolicy,
  errors,
  hexToBytes,
  isTerminal,
  signingMessageHex,
  type EnclaveRescueDecision,
  type RescueLock,
} from "./index.js";

test("lifecycle matches Rust state machine", () => {
  assert.ok(canTransition("PENDING_DEPOSIT", "PROCESSING"));
  assert.ok(canTransition("PENDING_DEPOSIT", "REFUNDED"));
  assert.ok(canTransition("PENDING_DEPOSIT", "FAILED"));
  assert.ok(canTransition("PROCESSING", "SUCCESS"));
  assert.ok(canTransition("PROCESSING", "REFUNDED"));
  assert.ok(canTransition("PROCESSING", "FAILED"));
  assert.ok(!canTransition("SUCCESS", "PROCESSING"));
  assert.ok(!canTransition("PENDING_DEPOSIT", "SUCCESS"));
  assert.ok(isTerminal("REFUNDED") && isTerminal("FAILED") && isTerminal("SUCCESS"));
  assert.ok(!isTerminal("PROCESSING") && !isTerminal("PENDING_DEPOSIT"));
});

test("policy commitment matches aegis-types", () => {
  const policy = { hf_min_bps: 10800, hf_target_bps: 12500, max_slippage_bps: 35, salt_hex: "00ff" };
  assert.equal(commitmentHash(policy), "3726c490cc40b3bbb31830322cb62e019f8745d6aed4dcd3b1d3bf9c680fa8c5");
  assert.equal(
    commitmentHash({ ...policy, hf_min_bps: 10801 }),
    "7f78254b75e217a3c64541645eabe2f2610bdc5f83773c35d68456389aab8f4a",
  );
  assert.throws(() => commitmentHash({ ...policy, salt_hex: "zz" }));
  assert.throws(() => commitmentHash({ ...policy, salt_hex: "0" }));
});

function sampleDecision(): EnclaveRescueDecision {
  return {
    request_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    account_id: "alice.near",
    observed_hf_bps: 10700,
    trigger_hf_bps: 10800,
    target_hf_bps: 12500,
    action: "REPAY_DEBT",
    repay_amount_raw: "345600000",
    oneclick_quote: {
      quote_id: "q1",
      dry: true,
      deposit_address: "deposit_addr_or_dry_run",
      amount_in: "345950000",
      amount_out: "345600000",
      solver_spread_bps: 10,
      liquidation_penalty_saved_bps: 600,
    },
    enclave_signature_hex: "ab".repeat(64),
    attestation_sha256: "cd".repeat(32),
  };
}

test("signing message matches aegis-types and ignores the signature field", () => {
  const decision = sampleDecision();
  const message = "e3a3d76c5f65f87acfe3a74fc05b952c6756308ce57be545826175da536dead5";
  assert.equal(signingMessageHex(decision), message);
  assert.equal(signingMessageHex({ ...decision, enclave_signature_hex: "00".repeat(64) }), message);
  assert.equal(
    signingMessageHex({ ...decision, repay_amount_raw: "345600001" }),
    "96682a685e324f259d5854a7f4bd5534ee081476cddb58a7fec2411ac36be122",
  );
  assert.equal(
    signingMessageHex({ ...decision, action: "NONE", oneclick_quote: null }),
    "dcda35cff2e1db46963633c22c8b0151d4486f2b620aa0b5d4abc5b3ac909e62",
  );
});

test("policy ciphertext matches the enclave", () => {
  const policy = { hf_min_bps: 10800, hf_target_bps: 12500, max_slippage_bps: 35, salt_hex: "a1b2c3" };
  const pub = hexToBytes("5dfedd3b6bd47f6fa28ee15d969d5bb0ea53774d488bdaf9df1c6e0124b3ef22");
  const ct = encryptPolicy(policy, pub, new Uint8Array(32).fill(5), new Uint8Array(12).fill(1));
  assert.equal(ct, "UKYUCbHd0DJemxa3AOcZ6XcsBwALG9d4bpB8ZT0gSV0BAQEBAQEBAQEBAQGdlL00kikk+qa/7oe4okZ/b5LlfqLvsECk7B/0dGvKwPDPM1S6MXQ1/BEbSgJWG3tICZ4K0nUbSDpt9wIAlI3lBR8UVL5P0MrDwEZD2hDknyp49ELfXgYsWSLslbsTIcWsIej2");
});

test("wire enums match serde rename_all", () => {
  const idle: RescueLock = JSON.parse("\"IDLE\"");
  const flying: RescueLock = JSON.parse("{\"IN_FLIGHT\":{\"request_id\":\"r1\"}}");
  assert.equal(idle, "IDLE");
  assert.deepEqual(flying, { IN_FLIGHT: { request_id: "r1" } });
  assert.equal(errors.UNAUTHORIZED_RECIPIENT, "ERR_UNAUTHORIZED_RECIPIENT");
});
