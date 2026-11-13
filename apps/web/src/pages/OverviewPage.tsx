import { Link } from "react-router";
import { useSession } from "../lib/session";
import { VAULT_TESTNET } from "../config";

export function OverviewPage() {
  const session = useSession();
  const latest = session.reads[0];
  const draft = session.drafts[0];
  const quote = session.quotes[0];
  return (
    <>
      <p className="kicker">Console</p>
      <h1>Session Telemetry & Position Monitor</h1>
      <p className="lede">
        Real-time telemetry and cached session inspection for Rhea/Burrow loan obligations and confidential enclave protection.
      </p>
      <div className="overview">
        <section className="panel">
          <p className="kicker">Monitored position</p>
          {latest ? (
            <>
              <p className="account-id">{latest.accountId}</p>
              <p className={latest.healthLabel === "Not calculated" ? "quiet-figure" : "figure num"}>{latest.healthLabel}</p>
              <p className="aside">{latest.priceNote ?? `${latest.collateralCount} collateral asset(s), ${latest.debtCount} debt obligation(s).`}</p>
              <Link to={`/app/positions/${encodeURIComponent(latest.accountId)}?network=${latest.network}`}>Inspect position</Link>
            </>
          ) : (
            <>
              <p className="quiet-figure">No active position loaded</p>
              <p className="aside">Query an on-chain Burrow account to inspect collateral ratios, debt obligations, and liquidation thresholds.</p>
              <Link to="/app/positions">Query Burrow position</Link>
            </>
          )}
        </section>
        <section className="panel">
          <p className="kicker">Enclave protection policy</p>
          {draft ? (
            <>
              <p style={{ fontWeight: 600 }}>Active draft configuration for {draft.accountId || "unspecified account"}.</p>
              <p className="aside">Minimum health {draft.minimum}, target {draft.target}, solver slippage cap {draft.slippage} bps. Client-side encrypted.</p>
              <Link to={`/app/protection/drafts/${draft.id}`}>Inspect drafted policy</Link>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 600 }}>No policy drafted in active session</p>
              <p className="aside">Client-side X25519 encrypted parameter specification. Commitments are generated locally prior to vault submission.</p>
              <Link to="/app/protection/new">Configure protection</Link>
            </>
          )}
        </section>
      </div>
      <div className="overview second">
        <section className="panel">
          <p className="kicker">Keeper oracle sentinel</p>
          <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>
            Autonomous solvency evaluation is executed by registered keepers via OutLayer TEE. Keepers submit cryptographically signed oracle price feeds directly to the vault contract.
          </p>
          <p className="aside" style={{ margin: 0 }}>
            Active deployment: <code>{VAULT_TESTNET}</code>
          </p>
        </section>
        <section className="panel">
          <p className="kicker">NEAR Intents liquidity rail</p>
          {quote ? (
            <>
              <p className="account-id">Quote {quote.id}</p>
              <p className="aside">Expected spread {quote.expectedBps} bps, worst-case bound {quote.worstBps} bps. Solver deposit address: {quote.depositAddress}.</p>
              <Link to={`/app/activity/quotes/${quote.id}`}>Inspect quote details</Link>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 600 }}>No 1Click quote in active session</p>
              <p className="aside">Real-time market routing and cross-chain execution pricing via the NEAR Intents 1Click solver network.</p>
              <Link to="/app/activity/new">Request 1Click quote</Link>
            </>
          )}
        </section>
      </div>
    </>
  );
}
