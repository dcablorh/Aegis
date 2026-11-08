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

function money(micro: bigint): string {
  return `$${formatUnits(micro.toString(), 6, 2)}`;
}

function readHf(label: string): number | null {
  return /^\d+\.\d{2}$/.test(label) ? Number(label) : null;
}
import { Button, Field, HealthScale, Notice, Pending, Section } from "../ui";

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
  collateralUsd: bigint | null;
  debtUsd: bigint | null;
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
  let collateralUsd = 0n;
  let debtUsd = 0n;
  for (const leg of account.collateral) {
    const built = describe(leg.token_id, "Collateral", leg.balance, priceById.get(leg.token_id) ?? null, configById, decimalsById, missing);
    rows.push(built.row);
    if (built.priced) {
      collateral.push(built.priced);
      collateralUsd += legUsd(built.priced);
    }
  }
  for (const leg of account.borrowed) {
    const built = describe(leg.token_id, "Debt", leg.balance, priceById.get(leg.token_id) ?? null, configById, decimalsById, missing);
    rows.push(built.row);
    if (built.priced) {
      borrowed.push(built.priced);
      debtUsd += legUsd(built.priced);
    }
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
  const priced = missing.length === 0;
  return {
    account,
    rows,
    healthLabel,
    discountLabel,
    priceNote,
    collateralUsd: priced ? collateralUsd : null,
    debtUsd: priced ? debtUsd : null,
  };
}

function legUsd(priced: { amount_raw: string; decimals: number; price_micro_usd: bigint }): bigint {
  return (BigInt(priced.amount_raw) * priced.price_micro_usd) / (10n ** BigInt(priced.decimals));
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

  const hf = result ? readHf(result.healthLabel) : null;
  const collateral = result?.rows.filter((row) => row.role === "Collateral") ?? [];
  const debt = result?.rows.filter((row) => row.role === "Debt") ?? [];

  return (
    <>
      <p className="kicker">Burrow</p>
      <h1>Position</h1>
      <p className="lede">
        Reads a Rhea/Burrow account from public RPC. A health marker appears only when every token in use has an oracle price and the account has debt.
        This page does not connect a wallet and does not submit a transaction.
      </p>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); void onRead(); }}>
        <Field label="Network">
          <select value={network} onChange={(event) => setNetwork(event.target.value as Network)}>
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </Field>
        <Field label="Account" hint="The Burrow account id, not a deposit address.">
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Button type="submit" disabled={pending || accountId.trim().length === 0} aria-busy={pending}>{pending ? "Reading" : "Read position"}</Button>
      </form>
      {error ? <Section title="Read failed"><Notice tone="error" title="Could not load the account">{error}</Notice></Section> : null}
      {pending ? <Pending label="Reading the account, asset config, and oracle." /> : null}
      {!pending && !result && !error ? (
        <div className="overview">
          <div className="panel">
            <p className="kicker">Health</p>
            <p className="quiet-figure">No read yet</p>
            <HealthScale hf={null} />
          </div>
          <div className="panel">
            <p className="kicker">This read returns</p>
            <ul className="plain">
              <li>Collateral and debt held on Burrow.</li>
              <li>A health marker only when prices and debt both exist.</li>
              <li>No wallet prompt and no transaction.</li>
            </ul>
          </div>
        </div>
      ) : null}
      {!pending && result ? (
        <>
          <div className="overview">
            <div className="panel">
              <p className="kicker">Health</p>
              <p className={hf === null ? "quiet-figure" : "figure num"}>{result.healthLabel}</p>
              <HealthScale hf={hf} />
              {result.priceNote ? <div className="aside"><Notice tone="warn" title="Health factor withheld">{result.priceNote}</Notice></div> : null}
            </div>
            <div className="panel">
              <p className="kicker">Account</p>
              <p className="account-id">{result.account.account_id}</p>
              <dl className="facts">
                <div><dt>Network</dt><dd>{network}</dd></div>
                <div><dt>Liquidation discount</dt><dd>{result.discountLabel}</dd></div>
                <div><dt>Collateral legs</dt><dd className="num">{collateral.length}</dd></div>
                <div><dt>Debt legs</dt><dd className="num">{debt.length}</dd></div>
              </dl>
            </div>
          </div>
          <Section title="Book">
            {result.collateralUsd !== null && result.debtUsd !== null ? (
              <Balance collateral={result.collateralUsd} debt={result.debtUsd} />
            ) : (
              <p className="aside">Dollar weights stay hidden until every token in use has an oracle price.</p>
            )}
            <div className="book">
              <Book title="Collateral" rows={collateral} />
              <Book title="Debt" rows={debt} />
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}

function Balance({ collateral, debt }: { collateral: bigint; debt: bigint }) {
  const total = collateral + debt;
  const share = total === 0n ? 0 : Number((collateral * 10_000n) / total) / 100;
  return (
    <div className="balance">
      <div className="balance-track" role="img" aria-label={`Collateral ${money(collateral)}, debt ${money(debt)}`}>
        <span className="col" style={{ width: `${share}%` }} />
        <span className="debt" style={{ width: `${100 - share}%` }} />
      </div>
      <div className="balance-key">
        <span>Collateral <b className="num">{money(collateral)}</b></span>
        <span>Debt <b className="num">{money(debt)}</b></span>
      </div>
    </div>
  );
}

function Book({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section>
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="empty-leg">None on this account.</p> : rows.map((row) => (
        <div className="leg" key={row.tokenId}>
          <strong title={row.tokenId}>{shortId(row.tokenId)}</strong>
          <span className="meta num">{row.amount} · {row.price} · weight {row.weight}</span>
        </div>
      ))}
    </section>
  );
}
