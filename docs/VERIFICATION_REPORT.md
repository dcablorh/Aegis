# AegisMargin: verification report

Date: 2026-11-10. Branch `main-2wnsm8` (same code as `main` plus the testnet kit and config updates).
Everything below was run from a clean Linux container. Testnet only, fake tokens, no mainnet funds.

## Bottom line

| Area | Result |
|---|---|
| Rust contracts and enclave tests | **Pass** (95 tests, 0 failures) |
| TypeScript package tests | **Pass** (20 tests, 0 failures) |
| Web app build and every screen | **Pass** (no console errors) |
| Live 1Click dry-run quote | **Pass** |
| Rescue on testnet, dry mode | **Pass** (enclave ran in OutLayer's TEE, vault verified it) |
| Rescue on testnet, execute flow | **Pass** (tokens moved, ticket settled, lock freed) |
| Judge script `pnpm demo:verify` | **Pass** |
| Real Burrow debt reduction | **Not shown** (see "Known limits") |
| Real cross-chain swap | **Not shown** (see "Known limits") |

## 1. Automated tests

| Crate or package | Tests |
|---|---|
| `aegis-types` | 7 |
| `aegis-position` | 7 |
| `aegis-vault` (unit / invariants / attack simulation) | 36 / 12 / 2 |
| `aegis-wasi` (enclave) | 31 |
| `shared-types` / `rhea-client` / `intents-client` | 5 / 4 / 11 |

The attack simulation shows a hijacked keeper failing every attack: paying `evil.near`, editing a signed answer, replaying an old one, taking admin powers, faking a success and running a ticket twice.

## 2. Frontend (checked in a real browser)

- All 11 routes load and render, and unknown paths redirect correctly.
- No console errors or failed requests on any page.
- The 6-step protection wizard completes (Position, Conditions, Action, Execution, Review, Prepare locally).
- The Activity page requests a live 1Click dry-run quote and shows expected and worst-case spread.
- The Security page agrees with the vault on chain: `evil.near` and the swap deposit address are **Blocked**; the borrower, position, Burrow, Ref and intents accounts are **Allowed**.
- The Position page reads Burrow live and handles accounts with no debt or no account.

## 3. Testnet deployment

Throwaway account family `aegis-cloud-319903.testnet`:

| Piece | Address or value |
|---|---|
| Vault | `vault.aegis-cloud-319903.testnet` |
| Borrower | `borrower1.aegis-cloud-319903.testnet` |
| Position account | `position1.aegis-cloud-319903.testnet` |
| Swap deposit stand-in | `swapdeposit.aegis-cloud-319903.testnet` |
| OutLayer project | `aegis-cloud-319903.testnet/aegis` |
| Enclave wasm (wasm32-wasip2) sha256 | `6323745e22be396983072e0bab46e673b559db5f6e17836f0d83fd19aec0d050` |
| Policy encryption key (X25519) | `31ba381a065a1501238c72b3668fe5b1aecd29074797800b0689bfe8be42b45e` |

Secrets in OutLayer are readable only by the keeper and the vault account. The seeds are throwaway test keys and are not in the repo.

## 4. The rescue, step by step

1. **Dry run.** The keeper triggered a check. The enclave ran inside OutLayer's TEE (about 10.4M instructions, about 1 second), decrypted the borrower's private policy, sized the repayment at 345.60 USDC (health 1.07, trigger 1.08) and signed the decision. The vault verified the signature and the program fingerprint, saw the quote was a dry run, and freed the lock: `RESCUE_NOT_EXECUTED:dry_run_quote_verified`.
2. **Approval.** With the quote set to non-dry, the vault approved a signed ticket: `RESCUE_APPROVED:6d6094408d10aec2548ac9f0482d37c6`.
3. **Execute.** The keeper executed the ticket once. `position1` fake USDC went from 1000 to 654.05, and `swapdeposit` went from 0 to 345.95, which equals `amountIn` in the signed ticket. The money went only to the address named inside the signed ticket.
4. **Settle.** Reporting `SUCCESS` ended in `RESCUE_SETTLED`. The ticket state is `SUCCESS` and the borrower's lock is `IDLE`.

## 5. Known limits (please read before presenting)

- **Simulated swap.** NEAR Intents has no testnet, so the non-dry quote is labelled `SIMULATED-testnet-non-dry-1`. Live 1Click quotes work, but only as dry runs, and the vault refuses to execute a dry quote.
- **Simulated inputs.** The position snapshot and signed price feed sent to the enclave are built by a test tool (the documented example: 1000 wNEAR at $4.28 against 2400 USDC). The Burrow account itself has no debt.
- **No Burrow debt drop yet.** Burrow testnet has no oracle prices, so the repay step was handed back instead of reducing a debt. The fix is a mock-oracle Burrow instance on testnet. It has not been done.
- **Keeper key.** In this run the keeper was the owner account. A production keeper should hold a function-call key only.

## 6. How to reproduce

```bash
# tests
cargo test --workspace
pnpm install --frozen-lockfile && pnpm test

# judge script (in a restricted container add:
# NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle>)
pnpm demo:verify

# web app
pnpm --filter @aegis/web build && (cd apps/web && npx vite preview)

# build the deployable files
cargo build -p aegis-vault -p aegis-position --target wasm32-unknown-unknown --release
cargo build -p aegis-wasi --target wasm32-wasip2 --release
```

`cargo run -p aegis-wasi --example testnet_kit -- keys|policy|trigger|quote` builds the policy, signed feed, trigger arguments and simulated quote used above. The step-by-step log of the testnet run is in `brain/STATUS.md`.

## 7. Still to do before submission

Demo video, X post, public repo and final submission payload (each needs the owner's approval).
