import { useState } from "react";
import {
  BURROW_MAINNET,
  BURROW_TESTNET,
  RPC_MAINNET,
  RPC_TESTNET,
  getAccount,
  getAssetsPaged,
  getConfig,
  getOraclePrices,
  getTokenMetadata,
  health,
  liquidationDiscountBps,
  priceToMicroUsd,
  type BurrowAccount,
  type OraclePrice,
} from "@aegis/rhea-client";
import { SAMPLE_ACCOUNT } from "../config";
import { formatHf, formatUnits, shortId } from "../format";
import { Button, Field, Notice, Section } from "../ui";

type Network = "testnet" | "mainnet";

interface Row {
  tokenId: string;
  role: "Collateral" | "Debt";
  amount: string;
  price: string;
  weight: string;
}

interface Result {
  account: BurrowAccount;
  rows: Row[];
  healthLabel: string;
  discountLabel: string;
  priceNote: string | null;
}

async function load(network: Network, accountId: string): Promise<Result> {
  const rpcUrl = network === "testnet" ? RPC_TESTNET : RPC_MAINNET;
  const burrowId = network === "testnet" ? BURROW_TESTNET : BURROW_MAINNET;
  const options = { rpcUrl };
  const [account, assets, config] = await Promise.all([
    getAccount(burrowId, accountId, options),
    getAssetsPaged(burrowId, options),
    getConfig(burrowId, options),
  ]);
  if (!account) throw new Error(`Burrow has no account for ${accountId}.`);
  const prices = await getOraclePrices(config.oracle_account_id, options);
  const priceById = new Map(prices.prices.map((entry) => [entry.asset_id, entry.price]));
  const configById = new Map(assets.map((asset) => [asset.token_id, asset.config]));
  const ids = [...new Set([...account.collateral, ...account.borrowed].map((leg) => leg.token_id))];
  const metaEntries = await Promise.all(ids.map(async (id) => [id, await getTokenMetadata(id, options)] as const));
  const decimalsById = new Map(metaEntries.map(([id, meta]) => [id, meta.decimals + (configById.get(id)?.extra_decimals ?? 0)]));

  const missing: string[] = [];
  const rows: Row[] = [];
  const collateral = [];
  const borrowed = [];
  for (const leg of account.collateral) {
    const built = describe(leg.token_id, "Collateral", leg.balance, priceById.get(leg.token_id) ?? null, configById, decimalsById, missing);
    rows.push(built.row);
    if (built.priced) collateral.push(built.priced);
  }
  for (const leg of account.borrowed) {
    const built = describe(leg.token_id, "Debt", leg.balance, priceById.get(leg.token_id) ?? null, configById, decimalsById, missing);
    rows.push(built.row);
    if (built.priced) borrowed.push(built.priced);
  }

  let healthLabel = "Not calculated";
  let discountLabel = "Not calculated";
  let priceNote: string | null = null;
  if (missing.length > 0) {
    priceNote = `No oracle price for ${missing.join(", ")}. Health factor is withheld.`;
  } else if (borrowed.length === 0) {
    priceNote = "This account has no debt, so a health factor is not defined.";
  } else if (collateral.length === 0) {
    priceNote = "This account has debt and no collateral.";
  } else {
    const position = health(collateral, borrowed);
    healthLabel = formatHf(position.hf_bps);
    const discount = liquidationDiscountBps(position.hf_bps);
    discountLabel = discount === 0n ? "0 bps while health is at least 1.00" : `${discount.toString()} bps`;
  }
  return { account, rows, healthLabel, discountLabel, priceNote };
}

function describe(
  tokenId: string,
  role: Row["role"],
  balance: string,
  price: OraclePrice | null,
  configById: Map<string, { volatility_ratio: number; extra_decimals: number }>,
  decimalsById: Map<string, number>,
  missing: string[],
) {
  const decimals = decimalsById.get(tokenId) ?? 0;
  const weight = configById.get(tokenId)?.volatility_ratio;
  const row: Row = {
    tokenId,
    role,
    amount: formatUnits(balance, decimals),
    price: price ? `$${formatUnits(priceToMicroUsd(price).toString(), 6, 4)}` : "Unavailable",
    weight: weight === undefined ? "Unknown" : `${weight} bps`,
  };
  if (!price || weight === undefined) {
    missing.push(tokenId);
    return { row, priced: null };
  }
  return {
    row,
    priced: { amount_raw: balance, decimals, weight_bps: weight, price_micro_usd: priceToMicroUsd(price) },
  };
}

export function PositionPage() {
  const [network, setNetwork] = useState<Network>("testnet");
  const [accountId, setAccountId] = useState(SAMPLE_ACCOUNT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onRead() {
    setPending(true);
    setError(null);
    try {
      setResult(await load(network, accountId.trim()));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "The Burrow read failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1>Position</h1>
      <p className="lede">
        Reads a Rhea/Burrow account from public RPC. Figures appear only when the oracle returns a price.
        This page does not connect a wallet and does not submit a transaction.
      </p>
      <form className="form" onSubmit={(event) => { event.preventDefault(); void onRead(); }}>
        <Field label="Network">
          <select value={network} onChange={(event) => setNetwork(event.target.value as Network)}>
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </Field>
        <Field label="Account" hint="The Burrow account id, not a deposit address.">
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Button type="submit" disabled={pending || accountId.trim().length === 0}>{pending ? "Reading" : "Read position"}</Button>
      </form>
      {error ? <Section title="Read failed"><Notice tone="error" title="Could not load the account">{error}</Notice></Section> : null}
      {result ? (
        <>
          <Section title="Account">
            <dl>
              <dt>Account</dt>
              <dd>{result.account.account_id}</dd>
              <dt>Health factor</dt>
              <dd className={result.healthLabel === "Not calculated" ? "" : "num figure"}>{result.healthLabel}</dd>
              <dt>Liquidation discount</dt>
              <dd>{result.discountLabel}</dd>
            </dl>
            {result.priceNote ? <div style={{ marginTop: 16 }}><Notice tone="warn" title="Health factor withheld">{result.priceNote}</Notice></div> : null}
          </Section>
          <Section title="Assets">
            {result.rows.length === 0 ? <p>No collateral and no debt on this account.</p> : (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Token</th>
                      <th className="num">Amount</th>
                      <th className="num">Price</th>
                      <th className="num">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={`${row.role}-${row.tokenId}`}>
                        <td>{row.role}</td>
                        <td title={row.tokenId}>{shortId(row.tokenId)}</td>
                        <td className="num">{row.amount}</td>
                        <td className="num">{row.price}</td>
                        <td className="num">{row.weight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      ) : null}
    </>
  );
}
