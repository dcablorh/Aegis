# Log: successes, failures, lessons (newest first)

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
