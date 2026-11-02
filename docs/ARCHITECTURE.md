# AegisMargin Architecture Decisions

## M0 findings (2026-11-02, verified against live docs)

### Toolchain
- rustc/cargo 1.94.1 (edition 2024 OK). Targets installed: `wasm32-unknown-unknown`, `wasm32-wasip1`.
- Not installed yet: `cargo-near`, `near-cli-rs` (needed at deploy time, M7).
- near-sdk 5.30.0, near-workspaces 0.24.0 are the current crates.

### OutLayer (`outlayer.near` / `outlayer.testnet`)
Source: https://app.outlayer.ai/docs/near-integration
- `request_execution` args (JSON): `source` (`Project{project_id,version_key}` or `WasmUrl{url,hash,build_target}`), `resource_limits` (required, `{}` ok), `input_data` (string, delivered to WASI **stdin**), `secrets_ref {profile, account_id}` (secrets appear as **env vars**), `response_format` (`Text|Json|Bytes`), `payer_account_id`, `params`. Attach NEAR deposit.
- WASI output = whatever the module writes to **stdout**.
- Result returns through a **normal promise callback** (`#[private]` method reading `env::promise_result(0)`), not a documented named resume method. Docs example gives the request 100 Tgas, callback 10 Tgas.

### Consequences for the plan (supersedes IMPLEMENTATION_PLAN.md Day 4 snippet)
1. Use `Promise::new(outlayer).function_call("request_execution", ...).then(Self::ext(self_id).on_enclave_decision(account_id, request_id))`. No `promise_yield_create` needed. (near-sdk's `env::promise_yield_create` takes a `register_id` and resume must be called from the same contract; unnecessary here.)
2. Invariant 3 is enforced by: `#[private]` callback (predecessor == vault itself), receipt result originating from the `outlayer_contract_id` call, `rescue_lock == InFlight(request_id)`, and a verified enclave Ed25519 signature + attestation hash on the decision. A "caller == outlayer" check on the callback is impossible/meaningless; document this.
3. Gas: request 100 Tgas + callback ~30 Tgas fits; repayment runs in a separate `execute_approved_rescue(ticket_id)` call (ApprovedRescueTicket path), as planned.
4. OutLayer docs do not mention a price oracle; the oracle payload format/pinned key must be verified from `out-layer/oracle-example` before M3. Open risk.

### Open items to verify before coding the dependent milestone
- Price-oracle payload + pubkey (M3).
- Burrow `ft_transfer_call` repay `msg` and NEAR-native USDC token id (M5).
- Whether `outlayer.testnet` is live and how enclave signing key / attestation is exposed to the contract (M5).

### Price oracle (`price-oracle.near` / `.testnet`) — verified from out-layer/oracle-example
- Signed feed: `payload` is a JSON string keyed by asset id; each entry `{price: "<int string>", expo (default -8), publish_time (unix s, oldest venue)}`.
- Ed25519, 64-byte signature, base64, over the **raw `payload` string bytes**; response carries `public_key` as `ed25519:...`. Pin the key; a change is a failure, not an update.
- Freshness: Invariant 4 uses `publish_time`/timestamp vs `block_timestamp` (<= 60 s). Initial pinned key must be confirmed through a trusted channel (open item).
- `aegis-types::OraclePricePayload` mirrors this shape (`payload`, `signature_b64`, `public_key`).

### Version pins
- rustc 1.99.1, `near-sdk 5.30.0`, `near-account-id 3.0.0` (shared by `aegis-types` and the vault so both use one `AccountId`).
