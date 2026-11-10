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

## 5. Known limits and the reason for each (please read before presenting)

| Limit | Why it is like this | What would remove it |
|---|---|---|
| **Swap is simulated.** The non-dry quote is labelled `SIMULATED-testnet-non-dry-1`. | NEAR Intents (the 1Click settlement network) exists only on mainnet. `intents.testnet` is an empty account, and 1Click rejects testnet accounts as recipients. Live quotes therefore work only as dry runs, and the vault refuses to execute a dry quote on purpose (so no one can "execute" a price check). | A tiny mainnet run with real funds. That needs the owner's explicit approval. |
| **Position snapshot and price feed are simulated.** The enclave is fed the documented example (1000 wNEAR at $4.28 vs 2400 USDC). | The Burrow account holds no debt, and the testnet price oracle (see next row) gives no usable prices, so there is no real position to read. The vault still verifies the feed's signature and age exactly as it would for a real one. | A real Burrow loan, which needs working Burrow prices. |
| **No Burrow debt drop shown.** The repay was handed back. | Burrow testnet reads prices from its own oracle, `priceoracle.testnet`, which returns none. Any borrow fails with "Asset price is missing", so no debt can be opened and none can fall. What was shown is that the position account sends the repay and Burrow credits that account. | A mock-oracle Burrow instance on testnet. Not done yet. |
| **Keeper was the owner account.** | It was the quickest way to run the test with one throwaway account. The vault's rules do not depend on it: only registered keepers may trigger or execute. | Register a separate function-call-key account as keeper before any real use. |
| **New throwaway stack, not the earlier one.** | The earlier account's key existed only inside a Codespace that stopped (GitHub billing error 402) and expired. Without that key the old contracts and OutLayer secrets could not be changed, so everything was redeployed under a fresh account. | Nothing needed. Old addresses in the docs were replaced. |

### Why some choices were made (design reasons)

- **Only a hash and ciphertext on chain.** The borrower's trigger levels stay secret so nobody can hunt a stop. The enclave opens the policy and checks it against the on-chain commitment, so a swapped ciphertext is caught.
- **The vault checks the price feed itself.** A keeper cannot lie about prices: the feed must be signed by the pinned oracle key and be under 60 seconds old.
- **Signed ticket decides where money goes.** The swap deposit address is allowed only inside a ticket signed by the pinned enclave key and matching the pinned program hash. That is why `swapdeposit` shows as Blocked on the Security page and still received funds during the rescue.
- **Execute and settle are separate calls.** Each needs its own gas budget, and the lock stays set until the outcome is reported, so a second rescue cannot start mid-flight. Refunded or failed outcomes free the lock too.
- **Dry-run mode first.** The first run used a dry quote so the whole pipeline could be proven with nothing able to move. Only then was the quote switched to non-dry.
- **Web app has no wallet.** It only reads and prepares data locally, so a demo cannot accidentally send a transaction.

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
