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
