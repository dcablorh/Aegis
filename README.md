# AegisMargin

Confidential repayment protection for a Rhea/Burrow loan. Private thresholds stay off the chain. A dry-run NEAR Intents quote is a price check, not a settlement.

Tracks: `defi`, `security`, `privacy`.

## Do X, see Y

**1. Check the documented loan maths, one live dry quote, and the vault allowlist**

```bash
pnpm install
pnpm demo:verify
```

You should see the sample testnet account, health 1.07 and a 345.60 USDC repayment marked as a documented example, a line beginning `LIVE 1CLICK DRY-RUN QUOTE`, and `evil.near` blocked. No tokens move.

**2. Open the read-only interface**

```bash
pnpm dev
```

Open `http://localhost:5173`.

- Position: type a Burrow account and read collateral, debt, and health when a price exists.
- Protection: prepare a local commitment and ciphertext. Nothing is submitted.
- Quote: request a dry-run 1Click quote. The deposit address is `dry_run`.
- Allowlist: ask the testnet vault whether a recipient is allowed.

**3. Run the contract tests**

See `contracts/README.md`.

## What is real

| Surface | Source |
|---|---|
| Burrow balances | Public RPC view of `get_account` |
| Health factor | Calculated only when every used token has an oracle price |
| 1Click quote with `dry: true` | Live solver price. No deposit and no swap |
| Allowlist | `is_recipient_allowed` on `vault.aegis-enclave-dev1.testnet` |
| Policy ciphertext | Built in the browser. Not sent to the vault |

Testnet Burrow prices are currently null, so that account's health factor is withheld. Wallet signing, policy registration, and a non-dry swap are not in this interface.
