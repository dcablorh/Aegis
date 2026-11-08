import { Link } from "react-router";
import { useSession } from "../lib/session";

export function OverviewPage() {
  const session = useSession();
  const latest = session.reads[0];
  const draft = session.drafts[0];
  const quote = session.quotes[0];
  return (
    <>
      <p className="kicker">Overview</p>
      <h1>What this browser has seen</h1>
      <p className="lede">Records below last until you close the tab. They are not a portfolio and not an execution history.</p>
      <div className="overview">
        <section className="panel">
          <p className="kicker">Latest position</p>
          {latest ? (
            <>
              <p className="account-id">{latest.accountId}</p>
              <p className={latest.healthLabel === "Not calculated" ? "quiet-figure" : "figure num"}>{latest.healthLabel}</p>
              <p className="aside">{latest.priceNote ?? `${latest.collateralCount} collateral, ${latest.debtCount} debt.`}</p>
              <Link to={`/app/positions/${encodeURIComponent(latest.accountId)}?network=${latest.network}`}>Open position</Link>
            </>
          ) : (
            <>
              <p className="quiet-figure">No read yet</p>
              <p className="aside">Read a Burrow account to place it here.</p>
              <Link to="/app/positions">Read a position</Link>
            </>
          )}
        </section>
        <section className="panel">
          <p className="kicker">Protection</p>
          {draft ? (
            <>
              <p>A local draft exists for {draft.accountId || "an unnamed account"}.</p>
              <p className="aside">Minimum {draft.minimum}, target {draft.target}, swap cap {draft.slippage} bps. The vault has no record of it.</p>
              <Link to={`/app/protection/drafts/${draft.id}`}>Open draft</Link>
            </>
          ) : (
            <>
              <p>No protection draft in this session.</p>
              <p className="aside">Preparing a policy encrypts it in the browser. It does not register it.</p>
              <Link to="/app/protection/new">Start a draft</Link>
            </>
          )}
        </section>
      </div>
      <div className="overview second">
        <section className="panel">
          <p className="kicker">Monitoring</p>
          <p>This page does not watch prices. A keeper calls the vault with a signed oracle payload. That call is not available here.</p>
        </section>
        <section className="panel">
          <p className="kicker">Latest dry quote</p>
          {quote ? (
            <>
              <p className="account-id">{quote.id}</p>
              <p className="aside">Expected {quote.expectedBps} bps, worst case {quote.worstBps} bps. Deposit address {quote.depositAddress}.</p>
              <Link to={`/app/activity/quotes/${quote.id}`}>Open quote</Link>
            </>
          ) : (
            <>
              <p>No quote in this session.</p>
              <Link to="/app/activity/new">Request a dry quote</Link>
            </>
          )}
        </section>
      </div>
    </>
  );
}
