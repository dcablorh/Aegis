import { Link } from "react-router";
import { useSession } from "../lib/session";

export function ProtectionCentrePage() {
  const { drafts } = useSession();
  return (
    <>
      <p className="kicker">Protection</p>
      <h1>Local drafts</h1>
      <p className="lede">A draft is a commitment and a ciphertext for the testnet enclave key. Confirming it does not call the vault.</p>
      <Link className="btn" to="/app/protection/new">New draft</Link>
      <section className="section">
        <h2>This session</h2>
        {drafts.length === 0 ? <p>No draft yet.</p> : (
          <table className="data">
            <thead>
              <tr><th>When</th><th>Account</th><th>Floor</th><th>Target</th><th>Cap</th></tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id}>
                  <td><Link to={`/app/protection/drafts/${draft.id}`}>{new Date(draft.at).toLocaleString()}</Link></td>
                  <td>{draft.accountId}</td>
                  <td className="num">{draft.minimum}</td>
                  <td className="num">{draft.target}</td>
                  <td className="num">{draft.slippage} bps</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="section">
        <h2>Production Integration Pipeline</h2>
        <ul className="plain">
          <li>Direct wallet policy registration via function-call key transaction.</li>
          <li>Automated keeper integration with Pyth/OutLayer signed price feeds.</li>
          <li>Live position synchronization and on-chain status tracking.</li>
        </ul>
      </section>
    </>
  );
}
