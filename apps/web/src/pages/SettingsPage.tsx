import { setNetwork, useSession } from "../lib/session";

export function SettingsPage() {
  const session = useSession();
  return (
    <>
      <p className="kicker">Settings</p>
      <h1>Network</h1>
      <p className="lede">This choice is the default for a new position read. Quotes always use 1Click on mainnet, because that API has no testnet. The allowlist always reads the testnet vault.</p>
      <label className="field">
        <span>Burrow network</span>
        <select value={session.network} onChange={(event) => setNetwork(event.target.value as "testnet" | "mainnet")}>
          <option value="testnet">Testnet</option>
          <option value="mainnet">Mainnet</option>
        </select>
        <span className="hint">Stored for this tab only.</span>
      </label>
      <section className="section">
        <h2>Wallet</h2>
        <p>No wallet is connected, and this build has no connect button. A signature would be required to register a policy. That transaction is not sent from here.</p>
      </section>
    </>
  );
}
