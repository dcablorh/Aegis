# Decisions and why

| Date | Decision | Why |
|---|---|---|
| 2026-11-02 | OutLayer answers come back through a normal callback, not pause/resume | The real OutLayer docs show a plain callback. The original plan's pause/resume code did not match. Simpler and correct. |
| 2026-11-02 | Repayment happens in a second call after the enclave answer is saved as a "ticket" | One call could run out of gas (300 Tgas limit). |
| 2026-11-02 | The fingerprint is `sha256("aegis-policy-v1" + three numbers + secret salt)` | The salt stops anyone guessing the numbers from the fingerprint. |
| 2026-11-02 | The allowed-recipient check is per borrower | The original plan only allowed the contract owner, which is the admin and not the borrower. |
| 2026-11-02 | Contract and enclave use whole numbers only | Money maths must not drift, and results must repeat exactly. |
| 2026-11-02 | `main` holds only the two source docs; work goes to `dev1/staging` first | Keeps the final branch clean until everything is checked. |
| 2026-11-02 | Upgraded Rust to 1.99.1 and NEAR toolkit to `near-sdk 5.30.0` | The team wants the latest versions. Needed a Windows workaround for tests (see SETUP.md). |
| 2026-11-02 | Borrower policy is encrypted to the enclave's X25519 key (ephemeral key + ChaCha20-Poly1305) | Only the enclave can open it; the website can encrypt without holding any secret. |
| 2026-11-02 | Enclave signs `sha256` of every money field of its decision; the shared function is in `aegis-types` | The vault must verify the exact same bytes. |
| 2026-11-02 | Swap-cost guard compares spread to the penalty avoided under a 20% collateral drop | The plan's version is always zero when the loan is still healthy. This is an assumption to review. |
| 2026-11-02 | Price history is passed in the input (`price_history`), each entry signature-checked | The oracle gives one price per call; volatility needs several. |
| 2026-11-02 | Each borrower gets a position sub-account (e.g. `alice.<vault>`) holding their Burrow loan; a small contract on it obeys only the vault | Burrow repays whichever account sends the tokens, so the loan must live on an account the vault can instruct. Keeps health and liquidation per borrower. |
| 2026-11-02 | A swap deposit address is allowed only while it sits inside the borrower's in-flight signed ticket | Keeps the "no arbitrary recipient" rule while still paying a different address each time. |
| 2026-11-02 | The enclave callback never panics once the lock is ours; bad answers free the lock and log a reason | A panic would roll the lock back and leave it stuck. |
| 2026-11-02 | A lying keeper cannot redirect money: `report_intent_status` only moves a capped repay amount from the borrower's own position to Burrow | The keeper reports swap outcomes, so its power must be limited. |
