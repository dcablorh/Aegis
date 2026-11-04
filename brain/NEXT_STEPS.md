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
