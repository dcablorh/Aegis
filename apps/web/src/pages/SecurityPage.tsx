import { useState } from "react";
import { Link } from "react-router";
import { RPC_TESTNET, viewFunction } from "@aegis/rhea-client";
import { ENCLAVE_X25519_HEX, VAULT_TESTNET } from "../config";
import { Button, Field, Notice, Pending } from "../ui";

export function SecurityPage() {
  const [borrower, setBorrower] = useState("borrower1.aegis-enclave-dev1.testnet");
  const [recipient, setRecipient] = useState("evil.near");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  async function onCheck() {
    setPending(true);
    setError(null);
    setAllowed(null);
    try {
      const result = await viewFunction<boolean>(
        VAULT_TESTNET,
        "is_recipient_allowed",
        { account_id: borrower.trim(), recipient: recipient.trim() },
        { rpcUrl: RPC_TESTNET },
      );
      setAllowed(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The vault view failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="kicker">Vault</p>
      <h1>Security</h1>
      <p className="lede">The allowlist is a live view. The encryption key is the public key this app encrypts to. There is no audit badge and no attestation score on this page.</p>
      <div className="overview">
        <form className="panel stack" onSubmit={(event) => { event.preventDefault(); void onCheck(); }}>
          <Field label="Borrower">
            <input value={borrower} onChange={(event) => setBorrower(event.target.value)} spellCheck={false} />
          </Field>
          <Field label="Recipient">
            <input value={recipient} onChange={(event) => setRecipient(event.target.value)} spellCheck={false} />
          </Field>
          <Button type="submit" disabled={pending || borrower.trim().length === 0 || recipient.trim().length === 0} aria-busy={pending}>
            {pending ? "Checking" : "Check recipient"}
          </Button>
        </form>
        <section className="panel">
          <p className="kicker">Static rule</p>
          <ul className="parties">
            <li><strong>Borrower</strong><span>The account itself.</span></li>
            <li><strong>Position</strong><span>That borrower's position account.</span></li>
            <li><strong>Burrow</strong><span>The lending contract.</span></li>
            <li><strong>Ref Finance</strong><span>The fallback venue.</span></li>
            <li><strong>intents.near</strong><span>The intents contract.</span></li>
          </ul>
          <p className="aside">A quote deposit address is not on this list. It is allowed only inside a signed rescue ticket. This page only reads the view.</p>
        </section>
      </div>
      {pending ? <div className="aside"><Pending label="Asking the testnet vault." /></div> : null}
      {error ? <div className="aside"><Notice tone="error" title="The vault did not answer">{error}</Notice></div> : null}
      {allowed !== null ? (
        <section className="section">
          <div className={allowed ? "panel verdict allowed" : "panel verdict blocked"}>
            <p className="verdict-word">{allowed ? "Allowed" : "Blocked"}</p>
            <p>{allowed ? `${recipient} is on the allowlist for ${borrower}.` : `${recipient} is not on the allowlist for ${borrower}. The view returned false.`}</p>
          </div>
        </section>
      ) : null}
      <section className="section">
        <h2>What this app can show</h2>
        <dl className="sheet">
          <dt>Vault</dt><dd>{VAULT_TESTNET}</dd>
          <dt>Policy encryption key</dt><dd className="num">{ENCLAVE_X25519_HEX}</dd>
          <dt>Wallet permissions</dt><dd>None. <Link to="/app/settings">Settings</Link> only chooses the RPC network.</dd>
          <dt>Attestation</dt><dd>The vault pins a program hash. This page does not display a verification badge for it.</dd>
        </dl>
      </section>
    </>
  );
}
