import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, isTerminal } from "./index.js";

test("lifecycle matches Rust state machine", () => {
  assert.ok(canTransition("PENDING_DEPOSIT", "PROCESSING"));
  assert.ok(canTransition("PROCESSING", "SUCCESS"));
  assert.ok(!canTransition("SUCCESS", "PROCESSING"));
  assert.ok(!canTransition("PENDING_DEPOSIT", "SUCCESS"));
  assert.ok(isTerminal("REFUNDED") && isTerminal("FAILED") && !isTerminal("PROCESSING"));
});
