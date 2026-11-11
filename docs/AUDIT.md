# AegisMargin audit (branch `remediation/audit`)

Scope note: this is a first-pass audit done from the repository and its own docs. `HACKATHON.md` is not in the repo, and no official hackathon, bounty or competitor research was done in this pass, so the requirements matrix, bounty verdicts and novelty score are NOT produced yet. Nothing here is an external audit.

## What was run (Windows, 2026-11-11)
- `AWS_LC_SYS_PREBUILT_NASM=1 cargo test -p aegis-types -p aegis-vault -p aegis-position -p aegis-wasi`
- Baseline: types 7, position 7, vault 36 unit + 12 invariant + 2 attack-sim, enclave 31. All pass.
- Without the env var the build fails on this machine (aws-lc-sys needs NASM). Doctests fail here because of a broken rustdoc shim, unrelated to the code.
- After fixes: vault 39 unit + 12 + 2, position 8. All pass.
- Not run: frontend build/tests, TypeScript packages, wasm builds, any testnet call.

## Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | `set_position` let any borrower link any account as their position, so the vault could move another person's reserve via `send_reserve`/`repay`. | Fixed: vault now asks the position contract `get_owner` and links only on a match (async callback). Tests added. |
| 2 | Medium | Tickets never expired; a keeper could execute a stale 1Click quote. | Fixed: `ERR_TICKET_EXPIRED` after 5 minutes. Test added. |
| 3 | Medium | `report_intent_status(Success)` is keeper-asserted. The vault repays Burrow without checking the swap settled, and a failed repay is not reported (ticket stays `SUCCESS`). | Open. Needs a human decision (verify via a settlement proof, or add a repay callback and a distinct state). |
| 4 | Medium | `attestation_sha256` is a field the enclave signs about itself. No remote attestation of the OutLayer TEE is verified on chain or off chain, so "confidential execution" rests on OutLayer's trust. | Open. Do not claim verified attestation. |
| 5 | Medium | `force_clear_lock` (owner) can clear a lock while a ticket is `Processing`. | Open. |
| 6 | Low | `price_history` is unbounded in `trigger_solvency_check`. | Open. |
| 7 | Info | The cross-chain swap, the Burrow position snapshot and the debt drop were never shown for real (simulated quote, fake tokens). The repo's own docs say so. | Open; needs a tiny mainnet run with explicit owner approval. |

## Deployment impact of the fixes
- `aegis-position` gained `get_owner`; `aegis-vault.set_position` now returns a Promise. Existing testnet deployments need redeploying (positions deployed earlier lack `get_owner`, so linking would be rejected). Not done: no deployments were made.

## Honest status
- Mainnet: not safe yet. Items 3, 4 and 7 stand between this and real funds.
- Baseline and post-remediation scores, bounty eligibility and novelty are not given because the research they depend on was not done.
