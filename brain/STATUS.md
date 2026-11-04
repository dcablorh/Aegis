# Status

_Last updated: 2026-11-02 (Developer 1)_

## Milestones (Developer 1)
| # | Milestone | State |
|---|---|---|
| M0 | Check tools and read the real docs (OutLayer, price oracle) | Done |
| M1 | Shared Rust types: fingerprint, price feed, rescue ticket, errors | Done, merged to staging |
| M2 | Vault: store policies, keepers, allowed recipients | Done, in PR #3 |
| M3 | Price check + start-a-rescue + lock | Done, in PR (needs real OutLayer test) |
| M4 | Secret-box program (enclave): the maths and the decision | Done, in PR (needs wasm build check, see below) |
| M5 | Handle the decision, repay on Burrow, handle refund/fail | Done in code with unit tests; not run on testnet |
| M6 | Security attack test + one test per rule | Done, in PR |
| M7 | Build, deploy to testnet, final docs | Done on testnet (vault + position); enclave not yet deployed to OutLayer |

## Tests right now
- `aegis-types`: 7 passing.
- `aegis-wasi` (enclave): 27 passing.
- `aegis-vault`: 35 unit + 12 invariant + 2 attack-simulation tests passing.
- `aegis-position`: 7 passing.

## Open pull requests
- #3 Vault contract (into `dev1/staging`).
- Enclave PR from `dev1/enclave` (into `dev1/staging`; includes #3's commits until #3 is merged).

## Not yet verified
- The enclave has not yet been built for `wasm32-wasip1` (the download was blocked by a network outage). Run `cargo build -p aegis-wasi --target wasm32-wasip1 --release` when online.
- Live 1Click HTTP calls from inside the enclave are not wired. The enclave reads the quote through a swappable source; today only an offline file/fixture works.

## Things we still do not know (must check before the milestone that needs them)
- The trusted public key of the price oracle (needed for M3).
- The exact message Burrow expects to repay a loan, and the right USDC token id (needed for M5).
- Whether `outlayer.testnet` is live, and how the enclave's signing key reaches the contract (needed for M5).

## Blockers
- None. Burrow repay problem solved with per-borrower position sub-accounts (DECISIONS.md).

## Testnet accounts (free faucet funds, keys local only)
- `vault.aegis-vault-dev1.testnet`: the real `aegis-vault`, owner and only keeper = `aegis-vault-dev1.testnet`. Oracle and enclave keys pinned are throwaway **test** keys (private halves are not in the repo).
- `alice.aegis-vault-dev1.testnet`: the borrower and position account (`aegis-position` deployed; its vault is the dev account `aegis-vault-dev1.testnet`, not yet the vault contract).
- Checked live: owner-only methods refuse strangers (`ERR_NOT_OWNER`); position refuses non-vault callers (`ERR_NOT_VAULT`); callback is private (`Method on_enclave_decision is private`); a signed price passes, locks the borrower, calls `outlayer.testnet`; when OutLayer fails the callback logs `RESCUE_NOT_EXECUTED:enclave_call_failed` and the lock returns to IDLE.

## OutLayer (testnet), created 2026-11-04 from a GitHub Codespace
- Project: `aegis-enclave-dev1.testnet/aegis`. Wasm built for `wasm32-wasip2`, sha256 `2740d0786eda65b9236f8ed34f121646a5facda266e932c1f87dca7bc337ce46`, stored on FastFS: `https://test.fastfs.io/aegis-enclave-dev1.testnet/outlayer.testnet/2740d0786eda65b9236f8ed34f121646a5facda266e932c1f87dca7bc337ce46.wasm`.
- Secrets stored under profile `default` (values live only in OutLayer and the Codespace, never in the repo): policy decryption key, enclave signing seed (same test key the vault pins), oracle public key, attestation hash, recipient, refund address, `AEGIS_LIVE=0`.
- Public key borrowers encrypt their policy to (X25519): `8cbe8e0e1d72afebfa4e25215bcb95520f93566628b25e7a4d54a6e56f9caf1e`.
- Spend so far: about 0.02 NEAR of free testnet funds. The signing account `aegis-enclave-dev1.testnet` has about 9.98 NEAR left; its key exists only inside the Codespace.
- **Known mismatches before a real end-to-end run:**
  1. The vault passes its own `owner_id` (`aegis-vault-dev1.testnet`) as the secrets owner, but the secrets belong to `aegis-enclave-dev1.testnet`. Fix: add a secrets-account setting to the vault (needs a fresh deploy because stored state changes), or redeploy the vault under the `aegis-enclave-dev1` account family.
  2. Secrets were stored with `--access allow-all`. Tighten to a whitelist of the vault contract account.
  3. The enclave has no way to get a swap quote inside OutLayer yet (no live HTTP, no offline source), so it exits with an error. Add an offline quote secret for the first run, then live `wasi-http-client`.

## Unverified assumptions (must be tested on testnet)
- (Checked) Burrow accepts the `Execute` message and credits the position account. (Not checked) a real debt going down: Burrow testnet has no oracle prices.
- The exact shape OutLayer returns to the callback (we accept a JSON object or a JSON string holding the decision).
- Moving the reserve to a 1Click deposit address with a plain token transfer works for NEAR-side origin tokens.
- Testnet has no NEAR Intents, so the cross-chain leg can only be shown as dry-run quotes there.
