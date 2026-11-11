# AegisMargin audit (branch `remediation/audit`)

Scope note: first-pass audit from the repository plus web research on 2026-11-11. The hackathon rules were read from the verbatim copy of `HACKATHON.md` inside `NEAR_HACKATHON_PROJECT_CONTEXT.md` (there is no standalone file); the live copy at https://nearhackathon.com/HACKATHON.md was not re-fetched and must be re-read before submitting. Nothing here is an external security audit. Frontend, TypeScript packages and testnet were not re-run.

## What was run (Windows, 2026-11-11)
- `AWS_LC_SYS_PREBUILT_NASM=1 cargo test -p aegis-types -p aegis-vault -p aegis-position -p aegis-wasi`
- Baseline: types 7, position 7, vault 36 unit + 12 invariant + 2 attack-sim, enclave 31. All pass.
- Without the env var the build fails on this machine (aws-lc-sys needs NASM). Doctests fail here because of a broken rustdoc shim, unrelated to the code.
- After fixes: vault 43 unit + 12 invariant + 2 attack-sim, position 8, types 7. All pass (enclave not rerun; unchanged).
- Not run: frontend build/tests, TypeScript packages, wasm builds, any testnet call.

## Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | `set_position` let any borrower link any account as their position, so the vault could move another person's reserve via `send_reserve`/`repay`. | Fixed: vault now asks the position contract `get_owner` and links only on a match (async callback). Tests added. |
| 2 | Medium | Tickets never expired; a keeper could execute a stale 1Click quote. | Fixed: `ERR_TICKET_EXPIRED` after 5 minutes. Test added. |
| 3 | Medium | `report_intent_status(Success)` is keeper-asserted, and a failed repay was still recorded as `SUCCESS` with the lock freed. | Partly fixed: ticket stays `PROCESSING` and locked until Burrow reports a non-zero repaid amount (`on_repay_result`), else `RESCUE_REPAY_FAILED` and the keeper can retry. Still open: the keeper can claim the swap settled; the worst case is repaying the borrower's own debt from balance already in the position. Verifying settlement itself needs a human decision. |
| 4 | Medium | `attestation_sha256` is a field the enclave signs about itself. No remote attestation of the OutLayer TEE is verified on chain or off chain, so "confidential execution" rests on OutLayer's trust. | Open. Do not claim verified attestation. |
| 5 | Medium | `force_clear_lock` (owner) could clear a lock while a ticket is `Processing`. | Fixed: refused (`ERR_TICKET_PROCESSING`) for the first hour; after that it clears and marks the ticket `FAILED`. |
| 6 | Low | `price_history` is unbounded in `trigger_solvency_check`. | Open. |
| 7 | Info | The cross-chain swap, the Burrow position snapshot and the debt drop were never shown for real (simulated quote, fake tokens). The repo's own docs say so. | Open; needs a tiny mainnet run with explicit owner approval. |

## Deployment impact of the fixes
- `aegis-position` gained `get_owner`; `aegis-vault.set_position` now returns a Promise. Existing testnet deployments need redeploying (positions deployed earlier lack `get_owner`, so linking would be rejected). Not done: no deployments were made.

## Honest status
- Mainnet: not safe yet. Items 3 (remaining part), 4 and 7 stand between this and real funds.
- Scores, track fit and novelty are below; they rest on web search and repo reading only.

## Hackathon requirements (source: HACKATHON.md copy in the context file)
| Requirement | Evidence | Status | Action |
|---|---|---|---|
| Public repo by 2026-11-14T23:59Z, with LICENSE | LICENSE (MIT) present; repo visibility not checked | Unknown | Owner makes it public |
| README a machine reader can follow ("do X, see Y") | Comprehensive README exists; reproduce steps in docs/VERIFICATION_REPORT.md | Likely OK | Add the Windows build note (`AWS_LC_SYS_PREBUILT_NASM=1`) |
| Demo post on X (@NEARProtocol, #NEARHackathon) with video | Not done per docs | Missing | Owner records and posts |
| Disclose pre-hackathon code / libs / AI code (Q-002/003/005) | Not checked in README | Unknown | Add a section; commit history starts 2026-11 |
| Submit once via API, human confirms payload | Not done | Missing | Owner confirms every field |
| Mandatory integrations | None (Q-011) | n/a | Nothing is disqualifying for lacking one |
| Intents testing: mainnet, tiny amounts, `dry: true` (Q-007) | Dry quotes done; execute step simulated | Partial | Judges will see simulated settlement; label it |

## Track fit (there are no separate bounties; prizes are per track plus a grand prize)
| Track | Fit | Verdict |
|---|---|---|
| `defi` ($10k/3k/2k) | Lending-protection using 1Click and Burrow | Likely eligible, evidence incomplete: real settlement and debt drop never shown |
| `privacy` | Encrypted thresholds, decision inside OutLayer TEE | Likely eligible, but TEE attestation is not verified (finding 4) |
| `security` | Keeper-scoped permissions, allowlists | Weak fit; mention only if the owner wants a third track |

## Competitors
| Project | Mechanism | Overlap | AegisMargin edge |
|---|---|---|---|
| [DeFi Saver](https://help.defisaver.com/features/automation/compatibility) | Automated repay/boost on Aave and others, via smart wallet | Same user problem, in production, public thresholds | Private thresholds; NEAR/Burrow coverage |
| [Reactive Network unified Aave protection](https://blog.reactive.network/aave-unified-protection-multi-strategy-automated-liquidation-defense-with-reactive-smart-contracts/) | Event-driven on-chain automation | Same problem | Private triggers |
| [Chainlink CRE confidential liquidation protection](https://docs.chain.link/cre-templates/automated-liquidation-protection) | Confidential workflow template (private beta) | Same idea: private TEE-evaluated protection | Open on NEAR; cross-chain funding via Intents |
| [Acurast YieldSense](https://acurast.com/blog/builder-spotlight/yieldsense/) | Encrypted stop-loss intent in a TEE worker, ERC-4626 on Base | Encrypted-trigger TEE keeper | Lending-specific |
| [Chainlink hackathon SentinelVault / Guardian](https://chain.link/hack-26/projects/sentinelvault) | Aave position monitor in an enclave | Hackathon prototypes | Further along on testnet |
| Burrow/Rhea | Competitive liquidators; no protection layer found | Gap on NEAR | First of its kind there, as far as I found |

Findings are from web search only; I did not verify vendor claims.

## Novelty
Problem originality 6/15, mechanism 8/25, technical differentiation 10/20, competitive advantage 8/20, uniqueness in ecosystem 12/20 = **44/100, incrementally innovative**. Automated liquidation protection and TEE-hidden triggers both exist elsewhere. What is new is doing it for NEAR lending with funds sourced through Intents. A defensible sharpening: show a real, verifiable attestation of the enclave (finding 4) and a real settled repay, because "private trigger + verifiable execution" is what the incumbents lack on NEAR. I did not implement a mechanism change; it is a design decision for the owner.

## Scores (my judgement, not a formula output)
| Category | Max | Baseline | After |
|---|---:|---:|---:|
| Novelty | 20 | 8 | 8 |
| Technical implementation | 20 | 12 | 12 |
| Hackathon fit and ecosystem | 15 | 9 | 9 |
| Product fit | 10 | 6 | 6 |
| DeFi mechanism | 10 | 5 | 5 |
| Security and reliability | 10 | 5 | 6 |
| UX | 5 | 3 | 3 |
| Engineering and docs | 5 | 4 | 4 |
| Demo and submission readiness | 5 | 2 | 2 |
| **Total** | 100 | **54** | **55** |

Security rose by 1 for two real fixes only. Mainnet readiness: not safe for mainnet. Verdict: possible dark horse in `defi`/`privacy`, hurt by simulated settlement, unverified attestation and no demo post yet.
