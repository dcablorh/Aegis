# Context

## The hackathon
NEAR Hackathon 2026. Build window: 2026-11-01 to 2026-11-14 (submit before 23:59 UTC on the 14th). The repo must be public by then and we need a demo post on X.

## The product in one paragraph
People who borrow money on Rhea/Burrow (a lending app on NEAR) get "liquidated" if the value of what they put up falls too far. Liquidation costs them a big penalty (around 6%). AegisMargin watches the loan and, before it gets dangerous, quietly repays part of the debt using money from another blockchain (through NEAR Intents). The borrower's safety numbers are kept secret inside a secure box (OutLayer enclave), so traders can't see them on-chain and attack the borrower.

## Tracks we are entering
`defi`, `security`, `privacy`.

## Pieces and who owns them
| Piece | Folder | Owner |
|---|---|---|
| Shared data shapes (Rust) | `crates/aegis-types` | Developer 1 |
| On-chain vault contract | `contracts/aegis-vault` | Developer 1 |
| Secret-box program (enclave) | `enclave/aegis-wasi` | Developer 1 |
| Security and rule tests | `contracts/aegis-vault/tests` | Developer 1 |
| Shared data shapes (TypeScript), swap client, lending reader, website, judge script | `packages/*`, `apps/web`, `scripts` | Developer 2 |

## The five rules the vault must always obey (called invariants)
1. The chain never stores the borrower's real safety numbers, only a fingerprint.
2. Money can only go to: the borrower, Burrow, the Ref exchange, or the swap service.
3. Only the real OutLayer answer can complete a rescue, and only while a rescue is running.
4. Price data must be signed by the trusted oracle and be less than 60 seconds old.
5. Every swap ends in a known final state (success, refunded or failed) and the lock is released.

## Branches
- `main`: kept clean, only the two source docs. We merge here only when everything is good.
- `dev1/staging`: where all work gathers for now. Pull requests go here.
- `dev1/<topic>`: one branch per piece of work, each with its own pull request.

## Rules from the team
- Do not use AI names in commits or PRs. Commit messages are short, lowercase, one line.
- No mainnet use, spending money, or hackathon submission without the human's OK.
- Real vs. simulated must always be labelled clearly (dry-run quotes are not real settlements).
