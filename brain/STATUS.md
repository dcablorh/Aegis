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
| M6 | Security attack test + one test per rule | Not started |
| M7 | Build, deploy to testnet, final docs | Not started |

## Tests right now
- `aegis-types`: 7 passing.
- `aegis-wasi` (enclave): 27 passing.
- `aegis-vault`: 35 passing (policy, keepers, oracle, rescue lifecycle, attack cases).
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

## Unverified assumptions (must be tested on testnet)
- The exact shape OutLayer returns to the callback (we accept a JSON object or a JSON string holding the decision).
- Burrow accepts the repay message from the position account (read in source, never run).
- Moving the reserve to a 1Click deposit address with a plain token transfer works for NEAR-side origin tokens.
- Testnet has no NEAR Intents, so the cross-chain leg can only be shown as dry-run quotes there.
