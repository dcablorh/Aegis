# Next steps (in order)

1. **Merge PR #3** (vault) into `dev1/staging`.
2. **M4, the enclave** (`enclave/aegis-wasi`), on a new branch `dev1/enclave` off staging.
   - Split into a library plus a thin `main`, so the judge script can run it on a normal computer.
   - Reads one JSON from stdin, prints one JSON decision to stdout.
   - Parts: check the price signature and age, open the policy and check it matches the fingerprint, compute the loan health, work out the secret trigger level, work out how much debt to repay, check the swap cost is acceptable, sign the result.
   - Use whole-number maths only (no decimals) so results are identical every time.
   - Tests with fixed example numbers, e.g. health 1.07 should lead to repaying about 345.60 USDC.
3. **Share the example numbers with Developer 2** so their website maths matches ours.
4. **M3**: price check, `trigger_solvency_check`, the rescue lock. Needs the oracle public key first.
5. **M5**: handle the enclave answer (OutLayer returns it through a normal callback, not pause/resume), save an approved rescue ticket, repay Burrow in a second call, handle refunds and failures.
6. **M6**: the "compromised keeper tries to steal funds" test, plus one test for each of the five rules.
7. **M7**: build, deploy to **testnet**, update docs, give Developer 2 the addresses.
8. Day before deadline: make repo public, record demo, X post, submission. All need the human's OK.

## Needs the human's decision later
- Any mainnet use or real-money test.
- Making the repo public, posting on X, sending the final submission.

## Update (M5 code done)
- Next: testnet spike. Create a position sub-account, put the position contract on it, open a small Burrow loan with `usdc.fakes.testnet`, call `repay` from a vault, and watch Burrow's debt drop.
- Then: find out OutLayer's real reply shape and adjust `process_decision` if needed.
- Then: M6 integration tests with `near-workspaces` (one per rule) and M7 deploy.

## Update (spike)
- Decide how to show a real debt drop: wait for testnet prices, run a mock-price Burrow, or a tiny mainnet test (needs human OK).
- Still untested: OutLayer's real reply shape (needs a deployed OutLayer project and the enclave wasm).

## Update (M6 done)
- Next: M7. Deploy the real vault to testnet, prove `#[private]` on the callback, set the enclave key and fingerprint, and write the final README and LICENSE.
- Open: show a real debt drop (needs oracle prices or a mock Burrow).

## Update (M7 done on testnet)
- Next big risk: put the enclave on OutLayer (project + secrets), deliver one real answer to the callback, and fix the reply-shape assumption if it differs.
- Then: wire live 1Click HTTP in the enclave, show a real debt drop, and hand the testnet addresses to Developer 2.

## Update (OutLayer prep done, nothing spent)
1. With the human's OK: upload the enclave wasm, create the project `aegis-vault-dev1.testnet/aegis`, set secrets (about 0.1 NEAR plus a refundable project deposit; each run about 0.007 NEAR).
2. Move the enclave to wasm32-wasip2 and add live 1Click quotes through `wasi-http-client`.
3. Deliver one real enclave answer to the vault callback and fix the reply-shape assumption if needed.

## Update (OutLayer project exists)
1. Make the vault take a separate secrets-account (or redeploy it under `aegis-enclave-dev1`), tighten secret access to the vault account.
2. Give the enclave an offline quote secret (`AEGIS_QUOTE_JSON`) for a first dry run, then live quotes via `wasi-http-client`.
3. Trigger from the vault and confirm OutLayer's real reply shape reaches `on_enclave_decision`.
4. Delete the Codespace when finished.

## Update (2026-11-04, usage limit reached mid-task; resume here)
Done: PR #9 (`dev1/e2e-dry-run`) has the vault secrets-account setting, the enclave `AEGIS_QUOTE_JSON` secret and the `e2e_fixture` tool. All tests pass.
In progress in Codespace `aegis-outlayer-wr97vp6v99qx2g7q4` (files copied there by hand, git fetch fails there): `npm install -g near-cli-rs` and builds of the vault wasm and enclave wasip2 (log: `/tmp/build2.log`, `/tmp/npm-near.log`).
Still to do, in order:
1. In the Codespace: create `vault.aegis-enclave-dev1.testnet` (about 4 NEAR) and a borrower sub-account; deploy the new vault wasm; `new` with owner `aegis-enclave-dev1.testnet`; `set_enclave` (key `51059e47...b63c` and the NEW enclave wasm hash); `set_outlayer_project("aegis-enclave-dev1.testnet/aegis","default","aegis-enclave-dev1.testnet")`; register keeper.
2. Upload the rebuilt enclave wasm, `outlayer deploy aegis <url>` (new version), then re-set ALL secrets (it overwrites): add `AEGIS_QUOTE_JSON` from `e2e_fixture`, update `AEGIS_ATTESTATION_SHA256` to the new hash, use `--access whitelist:vault.aegis-enclave-dev1.testnet`. Seeds are in `/tmp/sign_seed` and `/tmp/policy_seed` there.
3. Borrower `register_policy` with the fixture output; trigger with a fresh signed feed (HF 1.07 example: wrap.testnet 1000 at 4.28, usdc.fakes.testnet 2400 at 1.00); expect event `RESCUE_NOT_EXECUTED:dry_run_quote_verified`.
4. Delete the Codespace: `gh codespace delete -c aegis-outlayer-wr97vp6v99qx2g7q4`.

## Update (end-to-end dry run works)
Done: steps 1-3 of the previous list. Remaining, in order:
1. Live 1Click quotes inside the enclave (`wasi-http-client`, wasip2), still `dry: true`.
2. Deploy `aegis-position` under this vault family, set it as the borrower's position, and exercise `execute_approved_rescue` with a non-dry quote (needs the human's OK for any mainnet use; testnet has no NEAR Intents).
3. A real Burrow debt drop (needs oracle prices or a mock).
4. Hand testnet addresses to Developer 2; delete the Codespace when no longer needed (keys are backed up locally).
