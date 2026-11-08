import { useState } from "react";
import { RPC_TESTNET, viewFunction } from "@aegis/rhea-client";
import { VAULT_TESTNET } from "../config";
import { Button, Field, Notice, Pending, Section } from "../ui";

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
      <h1>Allowlist</h1>
      <p className="lede">
        Asks the deployed testnet vault whether this borrower may send funds to this recipient.
        A deposit address from a quote is not on this static list. It is allowed only while it sits inside a signed rescue ticket.
      </p>
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
          <p className="aside">Anything else is refused with ERR_UNAUTHORIZED_RECIPIENT when a transfer is attempted. This page only reads the view.</p>
        </section>
      </div>
      {pending ? <div className="aside"><Pending label="Asking the testnet vault." /></div> : null}
      {error ? <Section title="View failed"><Notice tone="error" title="The vault did not answer">{error}</Notice></Section> : null}
      {allowed !== null ? (
        <Section title="Result">
          <div className={allowed ? "panel verdict allowed" : "panel verdict blocked"}>
            <p className="verdict-word">{allowed ? "Allowed" : "Blocked"}</p>
            <p>
              {allowed
                ? `${recipient} is on the allowlist for ${borrower}.`
                : `${recipient} is not on the allowlist for ${borrower}. The view returned false.`}
            </p>
          </div>
        </Section>
      ) : null}
    </>
  );
}
