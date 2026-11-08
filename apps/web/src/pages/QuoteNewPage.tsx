import { useState } from "react";
import { useNavigate } from "react-router";
import { fetch1ClickQuote } from "@aegis/intents-client";
import { BASE_USDC, DRY_RECIPIENT, DRY_REFUND_TO, NEAR_USDC } from "../config";
import { rememberQuote } from "../lib/session";
import { Button, Field, Notice } from "../ui";

const STATES = ["Not started", "PENDING_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;

export function QuoteNewPage() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState("345600000");
  const [penalty, setPenalty] = useState("720");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onQuote() {
    if (!/^\d+$/.test(amount) || amount === "0") { setError("Output amount must be a positive integer in token units."); return; }
    const saved = Number(penalty);
    if (!Number.isInteger(saved) || saved < 0) { setError("Penalty saved must be a whole number of basis points."); return; }
    setPending(true);
    setError(null);
    const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    try {
      const quote = await fetch1ClickQuote({
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
      rememberQuote({
        id: quote.quote_id,
        at: new Date().toISOString(),
        amount,
        penalty: saved,
        dry: quote.dry,
        depositAddress: quote.deposit_address,
        amountIn: quote.amount_in,
        minAmountIn: quote.min_amount_in,
        amountOut: quote.amount_out,
        expectedBps: quote.solver_spread_bps,
        worstBps: quote.worst_case_spread_bps,
      });
      navigate(`/app/activity/quotes/${quote.quote_id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The quote request failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="kicker">1Click</p>
      <h1>Dry-run quote</h1>
      <p className="lede">Requests a live price with dry set to true. The default output, 345600000, is the documented 345.60 USDC example, not a balance from an account.</p>
      <form className="toolbar" onSubmit={(event) => { event.preventDefault(); void onQuote(); }}>
        <Field label="Output units" hint="NEAR USDC has 6 decimals.">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Penalty saved (bps)" hint="720 is the documented stress case.">
          <input value={penalty} onChange={(event) => setPenalty(event.target.value)} inputMode="numeric" />
        </Field>
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Requesting" : "Request dry-run quote"}</Button>
      </form>
      {error ? <Notice tone="error" title="1Click did not return a usable quote">{error}</Notice> : null}
      <section className="section">
        <h2>Settlement states</h2>
        <p className="aside">A dry quote never enters these states. They are the vault's states after a real deposit.</p>
        <ol className="rail">
          {STATES.map((state) => <li key={state} data-on={state === "Not started" ? "true" : "false"}>{state}</li>)}
        </ol>
      </section>
    </>
  );
}
