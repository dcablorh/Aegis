# AegisMargin: contracts and enclave (Workstream A)

This covers the Rust side: the vault contract, the per-borrower position contract, the private enclave program and their tests. The website and judge script (Workstream B) are documented separately.

## What is here
| Folder | What it is |
|---|---|
| `crates/aegis-types` | Data shapes shared by everything (policy, signed price feed, rescue decision, swap quote). Also the policy fingerprint and the exact bytes the enclave signs. |
| `contracts/aegis-vault` | The vault. Stores each borrower's policy as a fingerprint plus ciphertext, runs the rescue steps, and only lets money go to allowed places. |
| `contracts/aegis-position` | A tiny contract on each borrower's own sub-account. That account holds the Burrow loan. It obeys only the vault. |
| `enclave/aegis-wasi` | The private program that runs inside OutLayer. Decides if and how much to repay. |

## Do X, see Y

**1. Run all tests**
```bash
cargo test --workspace --lib --tests
```
You should see every test pass: types 7, position 7, vault 35 + 12 + 2, enclave 27. (On Windows add `AWS_LC_SYS_NO_ASM=1 CC=clang CXX=clang++`, see `brain/SETUP.md`.)

**2. Watch a hijacked keeper fail**
```bash
cargo test -p aegis-vault --test security_attack_sim -- --nocapture
```
You should see a log of 12 attacks (pay `evil.near`, edit a signed answer, replay an old one, take admin powers, fake a success, run a ticket twice), each marked `[BLOCKED]`.

**3. See the five vault rules checked one by one**
```bash
cargo test -p aegis-vault --test invariant_tests
```

**4. Build the contracts for NEAR**
```bash
cargo build -p aegis-vault -p aegis-position --target wasm32-unknown-unknown --release
```
You should get `aegis_vault.wasm` (about 348 KB) and `aegis_position.wasm` (about 150 KB) in `target/wasm32-unknown-unknown/release/`.

**5. Build the private program**
```bash
cargo build -p aegis-wasi --target wasm32-wasip1 --release
```

## How a rescue works (short)
1. A keeper (an account with a function-call key only) triggers a check. The vault verifies the signed price feed itself and locks the borrower.
2. OutLayer runs the enclave, which opens the borrower's secret policy, decides, asks for a swap quote, and signs its answer.
3. The vault checks the signature and the program fingerprint. A good answer becomes a ticket; a bad one frees the lock and logs why.
4. The keeper executes the ticket once. The borrower's position account sends its reserve to the swap deposit address named in that signed ticket, and nowhere else.
5. When the swap ends, the keeper reports it. Success repays Burrow from the position account. Refunded or failed frees the lock.

## Real vs. simulated (read this)
- NEAR Intents exists only on mainnet. Quotes taken on testnet are **dry-run quotes** (no money moves) and are labelled that way. The vault refuses to execute a dry-run quote.
- Live 1Click HTTP calls from inside the enclave are **not wired yet**. The enclave reads the quote through a swappable source; today only an offline file works.
- Burrow's testnet price oracle currently returns no prices, so a real debt reduction could not be shown on testnet. What was shown live: the position account sends the repay and Burrow credits **that** account.
- OutLayer's exact reply shape to the callback is unverified. The vault accepts a JSON object or a JSON string holding the decision.

## Testnet deployment (free faucet funds, no mainnet)
See `brain/STATUS.md` for the current addresses and what was checked live.
