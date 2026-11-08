import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { shortId } from "../format";
import { loadPosition, money, readHf, type PositionResult, type Row } from "../lib/position";
import { rememberRead, type Network } from "../lib/session";
import { HealthScale, Notice, Pending } from "../ui";

export function PositionDetailPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const accountId = params.accountId ?? "";
  const network: Network = search.get("network") === "mainnet" ? "mainnet" : "testnet";
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PositionResult | null>(null);

  useEffect(() => {
    let cancel = false;
    setPending(true);
    setError(null);
    loadPosition(network, accountId).then((next) => {
      if (cancel) return;
      setResult(next);
      rememberRead({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        network,
        accountId: next.account.account_id,
        healthLabel: next.healthLabel,
        collateralCount: next.rows.filter((row) => row.role === "Collateral").length,
        debtCount: next.rows.filter((row) => row.role === "Debt").length,
        priceNote: next.priceNote,
      });
    }).catch((cause: unknown) => {
      if (cancel) return;
      setResult(null);
      setError(cause instanceof Error ? cause.message : "The Burrow read failed.");
    }).finally(() => {
      if (!cancel) setPending(false);
    });
    return () => { cancel = true; };
  }, [accountId, network]);

  const hf = result ? readHf(result.healthLabel) : null;
  const collateral = result?.rows.filter((row) => row.role === "Collateral") ?? [];
  const debt = result?.rows.filter((row) => row.role === "Debt") ?? [];

  return (
    <>
      <p className="kicker">{network}</p>
      <h1>Position</h1>
      <p className="lede">A fresh Burrow read. Health is shown only when every token in use has an oracle price and the account has debt.</p>
      {pending ? <Pending label="Reading the account, asset config, and oracle." /> : null}
      {error ? <Notice tone="error" title="Could not load the account">{error}</Notice> : null}
      {result ? (
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
              <div className="split-actions">
                <Link className="btn" to={`/app/protection/new?account=${encodeURIComponent(result.account.account_id)}`}>Draft protection</Link>
                <Link className="btn secondary" to="/app/activity/new">Dry-run quote</Link>
              </div>
            </div>
          </div>
          <section className="section">
            <h2>Book</h2>
            {result.collateralUsd !== null && result.debtUsd !== null ? <Balance collateral={result.collateralUsd} debt={result.debtUsd} /> : <p className="aside">Dollar weights stay hidden until every token in use has an oracle price.</p>}
            <div className="book">
              <Book title="Collateral" rows={collateral} />
              <Book title="Debt" rows={debt} />
            </div>
          </section>
          <section className="section">
            <h2>Associated records</h2>
            <p className="aside">There is no on-chain strategy for this account in the app. A local draft, if you prepare one, stays in this tab.</p>
          </section>
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
