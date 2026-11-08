import { useState } from "react";
import { fetch1ClickQuote, type QuoteDetails } from "@aegis/intents-client";
import { BASE_USDC, DRY_RECIPIENT, DRY_REFUND_TO, NEAR_USDC } from "../config";
import { formatBps } from "../format";
import { Button, Field, Notice, Pending, Section, SpreadScale } from "../ui";

const STATES = ["Not started", "PENDING_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;

export function QuotePage() {
  const [amount, setAmount] = useState("345600000");
  const [penalty, setPenalty] = useState("720");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteDetails | null>(null);

  async function onQuote() {
    if (!/^\d+$/.test(amount) || amount === "0") {
      setError("Output amount must be a positive integer in token units.");
      setQuote(null);
      return;
    }
    const saved = Number(penalty);
    if (!Number.isInteger(saved) || saved < 0) {
      setError("Penalty saved must be a whole number of basis points.");
      setQuote(null);
      return;
    }
    setPending(true);
    setError(null);
    const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    try {
      const next = await fetch1ClickQuote({
        dry: true,
        swapType: "EXACT_OUTPUT",
        originAsset: BASE_USDC,
        destinationAsset: NEAR_USDC,
        amount,
        recipient: DRY_RECIPIENT,
        recipientType: "DESTINATION_CHAIN",
        refundTo: DRY_REFUND_TO,
        refundType: "ORIGIN_CHAIN",
        slippageTolerance: 100,
        depositType: "ORIGIN_CHAIN",
        deadline,
      }, { liquidationPenaltySavedBps: saved });
      setQuote(next);
    } catch (cause) {
      setQuote(null);
      setError(cause instanceof Error ? cause.message : "The quote request failed.");
    } finally {
      setPending(false);
    }
  }

  const rejected = quote !== null && quote.worst_case_spread_bps >= Number(penalty);

  const penaltyBps = Number(penalty);

  return (
    <>
      <p className="kicker">1Click</p>
      <h1>Dry-run quote</h1>
      <p className="lede">
        Requests a live 1Click price with dry set to true. No deposit address is created and no swap starts.
        The default output, 345600000, is the documented 345.60 USDC example, not a balance from your account.
      </p>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); void onQuote(); }}>
        <Field label="Output units" hint="NEAR USDC has 6 decimals.">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Penalty saved (bps)" hint="Compared with the worst-case spread. 720 is the documented stress case.">
          <input value={penalty} onChange={(event) => setPenalty(event.target.value)} inputMode="numeric" />
        </Field>
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Requesting" : "Request dry-run quote"}</Button>
      </form>
      <Section title="Settlement states">
        <p className="aside">A dry quote never enters these states. They are the vault's states after a real deposit.</p>
        <ol className="rail">
          {STATES.map((state) => <li key={state} data-on={state === "Not started" ? "true" : "false"}>{state}</li>)}
        </ol>
      </Section>
      {pending ? <Pending label="Asking 1Click for a dry quote." /> : null}
      {error ? <Section title="Quote failed"><Notice tone="error" title="1Click did not return a usable quote">{error}</Notice></Section> : null}
      {quote ? (
        <Section title="LIVE 1CLICK DRY-RUN QUOTE">
          <div className="panel">
            <SpreadScale expected={quote.solver_spread_bps} worst={quote.worst_case_spread_bps} penalty={Number.isInteger(penaltyBps) ? penaltyBps : 0} />
          </div>
          <dl className="sheet spaced">
            <dt>Quote id</dt>
            <dd className="num">{quote.quote_id}</dd>
            <dt>Dry</dt>
            <dd>{quote.dry ? "true" : "false"}</dd>
            <dt>Deposit address</dt>
            <dd>{quote.deposit_address}</dd>
            <dt>Amount in</dt>
            <dd className="num">{quote.amount_in}</dd>
            <dt>Minimum amount in</dt>
            <dd className="num">{quote.min_amount_in}</dd>
            <dt>Amount out</dt>
            <dd className="num">{quote.amount_out}</dd>
            <dt>Expected spread</dt>
            <dd className="num">{formatBps(quote.solver_spread_bps)} ({quote.solver_spread_bps} bps)</dd>
            <dt>Worst-case spread</dt>
            <dd className="num">{formatBps(quote.worst_case_spread_bps)} ({quote.worst_case_spread_bps} bps)</dd>
          </dl>
          <div className="aside">
            {rejected ? (
              <Notice tone="warn" title="The enclave would reject this quote">
                Worst-case spread is not below the penalty you entered. Nothing was executed.
              </Notice>
            ) : (
              <Notice title="Price only">
                Expected spread uses minimum amount in. Worst-case spread uses amount in, which includes the slippage buffer. The vault will not execute a dry quote.
              </Notice>
            )}
          </div>
        </Section>
      ) : null}
    </>
  );
}
