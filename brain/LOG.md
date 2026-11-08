# Log: successes, failures, lessons (newest first)

## 2026-11-04 (live 1Click dry-run quotes)
**Worked**
- HTTP from the enclave via `wasi-http-client` on wasip2. End to end: vault -> OutLayer TEE -> live 1Click dry quote -> signed decision -> vault verifies -> `dry_run_quote_verified`.
- Saved a real 1Click response as a test fixture (`enclave/aegis-wasi/tests/fixtures/1click_dry_live.json`) so the parser is tested against reality.

**Failed, then fixed**
- Design bug: 1Click's `amountIn` already includes the slippage buffer, so "spread" measured from it was always at least the borrower's own slippage limit (102 bps vs a 100 bps limit) and every rescue was refused. Now: expected cost comes from `minAmountIn` (about 1 bps) and the full `amountIn` is only the worst case, checked against the liquidation penalty saved.
- 1Click returns HTTP 400 for a testnet account as recipient. Use a mainnet-valid address for dry price checks.
- Quote prices move between calls (51 bps, then 102 bps worst case) so tests must not hard-code a live spread.

**Lessons**
- Test parsers against a real recorded response, not only a hand-written one.

## 2026-11-04 (first real end-to-end dry run)
**Worked**
- Fresh vault deployed under the `aegis-enclave-dev1` account family, new enclave version uploaded, secrets re-set with a whitelist, borrower policy registered with a real encrypted fixture. A trigger ended with `dry_run_quote_verified` after the enclave ran in OutLayer's TEE and the vault verified its signature on chain.

**Failed, then fixed (three real bugs found by running it)**
1. `/tmp` in the Codespace is wiped when it shuts down, so saved keys vanished. Keep secrets under the home folder and back them up.
2. The first versions were refused with "Access denied by access condition": OutLayer evaluates the secret whitelist against the transaction **signer** (the keeper), not just the calling contract. The whitelist now has both.
3. The vault sent empty OutLayer limits (`{}`), which the worker rejected ("Execution promise failed"). The vault now sends explicit limits (1 billion instructions, 128 MB, 10 s). This was invisible in unit tests.

**Lessons**
- Unit tests cannot find integration mistakes like these; only a real run did. Keep at least one live smoke test in the checklist.
- The Codespace holds the only copy of some testnet keys; they are now also backed up locally (outside the repo) in `~/aegis-codespace-backup` and `~/.near-credentials/testnet`.

**Still not done**
- Live 1Click quotes (the quote is a saved dry-run), real money movement, position-account execution against this vault, and a real Burrow debt drop.

## 2026-11-04 (OutLayer project created, via Codespace)
**Worked**
- Local install of `outlayer-cli` failed twice: the disk is nearly full (1.3 GB free) and a compile ran out of space. The human approved doing it in a GitHub Codespace instead.
- In the Codespace: installed Rust and `outlayer-cli` 0.2.1 (about 8 minutes), built the enclave for `wasm32-wasip2` (335 KB), created a fresh throwaway testnet account (so no existing key left this machine), logged in, uploaded the wasm, created the project and stored the secrets.

**Not done / found**
- Three mismatches listed in STATUS.md stop a real end-to-end run.
- The Codespace is set to stop after 30 idle minutes and be removed 24 hours after that. Delete it sooner with `gh codespace delete -c aegis-outlayer-wr97vp6v99qx2g7q4`.

## 2026-11-04 (OutLayer preparation, nothing spent)
**Read the OutLayer docs (app.outlayer.ai/docs: projects, secrets, wasi, pricing)**
- Output limit is **900 bytes**. Our worst-case signed decision is 686 bytes (new test guards this).
- Outbound HTTP from the program needs the **wasm32-wasip2** target and the `wasi-http-client` crate. Our program currently builds for wasip1 (no HTTP). A wasip2 build of it already compiles (about 335 KB).
- A project is created from a WASM URL plus its SHA-256 (`outlayer upload`, then dashboard "New Project" or `outlayer deploy`). Project id format is `owner_account/name`. A project has a refundable storage deposit. Secrets are encrypted in the browser and exposed to the program as environment variables; auto-generated secrets (for example an Ed25519 key made inside the TEE) are named `PROTECTED_*`.
- Estimated cost of one run on testnet from the view call `estimate_execution_cost`: 0.007 NEAR (1 billion instructions, 60 s).
- Docs do not say: the project deposit amount, whether the dashboard supports testnet, or secret size limits. Failed runs are not refunded.

## 2026-11-04 (M7 testnet deploy)
**Worked**
- Deployed the real vault to `vault.aegis-vault-dev1.testnet` and ran live checks (see STATUS.md). `#[private]` on the callback is proven on a real network. A full trigger with a signed price reached `outlayer.testnet` and recovered cleanly when OutLayer failed.
- Size-optimised release profile took the vault wasm from 524 KB to about 335 KB (storage on chain costs about 1 NEAR per 100 KB).
- Added `LICENSE` (MIT), `contracts/README.md` (do X - see Y) and `.env.example`.

**Failed, then fixed (important)**
- The first deploy answered every refusal with a bare "unreachable" trap and no message. Cause: our plain `cargo build` did not set `--cfg near`, which near-sdk needs to use the real host functions (including the panic message). `cargo-near` sets it for you. Fix: `.cargo/config.toml` now sets `--cfg near` for the wasm target. After the fix the messages show (`ERR_NOT_OWNER`, `Method on_enclave_decision is private`, ...).
- Lesson: any wasm built without that flag is **not** a faithful contract build. Always build wasm from this repo (it picks up the flag).
- `panic = "abort"` was not the cause; it is left out of the release profile.

**Still not done**
- The enclave program is not deployed to OutLayer, so no real enclave answer has been delivered yet.
- Real debt reduction on Burrow, and live 1Click quotes, remain unproven.

## 2026-11-04 (M6 security and invariant tests)
**Worked**
- `contracts/aegis-vault/tests/invariant_tests.rs`: 12 tests, grouped by the five invariants, using only public vault methods.
- `contracts/aegis-vault/tests/security_attack_sim.rs`: a compromised keeper tries 12 attacks (redirect money, forge or tamper with the enclave answer, replay an old answer, grab admin powers, fake a SUCCESS, execute twice). All refused. Read the audit log with `cargo test -p aegis-vault --test security_attack_sim -- --nocapture`.

**Failed, then fixed**
- First storage-privacy test saw an empty storage: the toolkit's collections only write when dropped. The test now drops the vault first, as the runtime does at the end of a call.
- My first "replay" attack reused the same request id by accident (the test random seed is fixed), so it proved nothing. Now the second rescue uses a different seed and the test checks the ids differ.

**Not covered by these tests**
- That only the vault itself can call the enclave callback (`#[private]`). That check lives in the compiled contract entry point, so it can only be proven on testnet.
- `near-workspaces` (full sandbox) was not used: it does not run on Windows.

## 2026-11-02 (live testnet spike: position -> Burrow)
**Setup (testnet only, free faucet funds, keys stay in `~/.near-credentials`, never in the repo)**
- `aegis-vault-dev1.testnet` stands in for the vault (10 NEAR from the faucet).
- `alice.aegis-vault-dev1.testnet` is the position sub-account (3 NEAR) with `aegis-position` deployed and initialised. The compiled wasm was accepted by testnet as-is.
- Registered alice on Burrow testnet, minted 1000 fake USDC (`usdc.fakes.testnet`), put 600 in Burrow as collateral.

**Worked**
- Burrow accepted a collateral deposit made with `ft_transfer_call` and the `Execute` message. So the message format is right.
- The vault account called `repay` on the position. The position called the token, the token called Burrow, and Burrow credited **the position account** (`alice...`) in its deposit event. That is the whole point of the sub-account design.
- The position's own checks work on a real network (only the vault account may call it).

**Could not do**
- Open a real loan: Burrow testnet's price oracle (`priceoracle.testnet`) returns no prices, so any borrow fails with "Asset price is missing". Without debt, the repay was handed back (1 USDC refunded), so we have **not** yet seen a debt actually go down.
- Options: wait for testnet prices to return; run our own Burrow copy with a mock price feed; or show the debt drop on mainnet with a tiny amount (needs the human's OK).

**Lessons**
- `cargo install near-cli-rs` fails on Windows (OpenSSL). `npm install -g near-cli-rs` works, but run it from PowerShell: Git Bash's tar breaks on `C:\` paths.
- Burrow needs the caller registered, the token needs the caller registered, and `oracle_call` needs exactly 1 yoctoNEAR attached.

## 2026-11-02 (testnet spike, read-only part)
**Checked over public testnet RPC (no accounts, no funds)**
- `outlayer.testnet` is live and answers view calls (`estimate_execution_cost` works).
- `price-oracle.testnet` is live.
- `intents.testnet` does **not** exist (empty account). Confirms there is no NEAR Intents on testnet: the cross-chain leg can only be a dry-run quote there.
- Burrow testnet (`contract.1638481328.burrow.testnet`) uses its **own** price oracle, `priceoracle.testnet`, with a 90 s recency limit. Our rescue prices come from `price-oracle.testnet`, so the two can differ slightly. The demo must say which price drives which decision.
- Still to do (needs a testnet account): deploy the position contract, open a small `usdc.fakes.testnet` loan, call repay, watch debt drop.

## 2026-11-02 (M3 + M5 vault rescue, position sub-account)
**Worked**
- Checked Burrow testnet over RPC: `contract.1638481328.burrow.testnet` is live; `usdc.fakes.testnet` and `wrap.testnet` are listed and can be borrowed/used as collateral.
- Built `contracts/aegis-position` (7 tests) and the vault rescue flow: trigger with oracle check, enclave callback, signed ticket, execute, final status (35 vault tests). Both build for wasm.

**Failed, then fixed**
- `.into()` on a method name was ambiguous with the newer toolkit; removed it.
- The toolkit-upgrade commit was not in the merged vault PR, so staging was still on the old toolkit. This work is stacked on the enclave PR which carries the upgrade.

**Lessons**
- A panic inside a callback undoes its changes, so the callback records a reason and frees the lock instead.
- Not yet proven on a real network: OutLayer's reply shape and Burrow accepting the repay.

## 2026-11-02 (M4 enclave)
**Worked**
- Built the enclave as a library plus a thin program: price check, policy decryption, loan health, volatility trigger, repayment size, swap-quote check and signing. 27 tests pass.
- The doc example reproduces exactly: health 1.07, trigger 1.08, repay 345.60 USDC.
- Confirmed the real 1Click response fields from the live docs before parsing them.

**Failed, then fixed**
- One of my own tests had the wrong expectation (the volatility buffer gave 1.069 which is below a 1.08 floor, so the floor wins). Fixed the test, not the maths.
- Wasm build could not download packages (no network). Not retried successfully yet.

**Lessons / things to know**
- The plan's guard `spread < liquidation discount at projected HF` makes no sense when HF is above 1 (discount is 0). We now price the avoided penalty at a stress case: collateral falls 20%. This is an assumption, written in DECISIONS.md.
- The signed decision hash lives in `aegis-types` (`signing_message`), so the vault checks exactly what the enclave signed.

## 2026-11-02 (M5 research)
**Found (blocker for M5 design)**
- Read Burrow's source (NearDeFi/burrowland, `ft_on_transfer` in `fungible_token.rs`, `Action` in `actions.rs`). The repay message is `{"Execute":{"actions":[{"Repay":{"token_id":"<ft>","amount":"<raw>"}}]}}` (amount optional/per `AssetAmount`), sent with `ft_transfer_call` to Burrow.
- The actions run on the **sender of the ft_transfer_call**, not on a named account. There is no "repay on behalf of". So if the vault sends the funds, Burrow repays the **vault's own** Burrow account, not the borrower's loan.
- Still unchecked: Burrow testnet address, USDC token id on testnet.

## 2026-11-02
**Worked**
- Read the real OutLayer and oracle docs and wrote down what they actually say (`docs/ARCHITECTURE.md`).
- Shared types and fingerprint function done and tested.
- Vault contract built: policies, keepers, allowed recipients, rescue lock. 11 tests pass.
- Upgraded to the latest Rust and NEAR toolkit; all 17 tests still pass.

**Failed, then fixed**
- First pull request failed ("no commits between main and branch") because `main` was cleaned after the branch was made. Fixed by restoring the code on a new branch and re-pointing the stacked PR.
- Pull requests #1 and #2 got merged straight into `main` by the human, so `main` briefly had code in it. Fixed with a revert commit; the code now lives on `dev1/staging`.
- Vault would not compile with the newest toolkit on the old Rust (1.94). Temporary fix: older toolkit. Final fix: upgraded Rust.
- Two different "account id" types clashed between our types and the toolkit. Fixed by using the same version in both.
- Latest toolkit test build failed on Windows (a C library, `aws-lc-sys`, would not build with the Visual Studio compiler, and then needed a missing tool called NASM). Fixed with clang and a no-assembly flag (SETUP.md).
- `cargo test` doc-test step fails with a missing `rustdoc.exe` path from an old Chocolatey Rust. Not a code bug. Use `--lib` or remove the old Chocolatey Rust.

**Lessons**
- Check the real docs before copying code from the plan; parts of the plan's sample code were wrong.
- Push small stacked PRs; the order of merging matters.
