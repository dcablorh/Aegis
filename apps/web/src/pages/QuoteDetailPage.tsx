import { useState } from "react";
import { Link, useParams } from "react-router";
import { formatBps } from "../format";
import { findQuote } from "../lib/session";
import { Notice, SpreadScale } from "../ui";

const STATES = ["Not started", "PENDING_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;

export function QuoteDetailPage() {
  const { quoteId } = useParams();
  const quote = quoteId ? findQuote(quoteId) : undefined;
  const [copied, setCopied] = useState(false);
  if (!quote) {
    return (
      <>
        <h1>Quote</h1>
        <Notice tone="warn" title="Not in this session">Request a dry quote from Activity. Quotes are not loaded from 1Click by id.</Notice>
        <Link to="/app/activity/new">Request a dry quote</Link>
      </>
    );
  }
  const rejected = quote.worstBps >= quote.penalty;
  return (
    <>
      <p className="kicker">LIVE 1CLICK DRY-RUN QUOTE</p>
      <h1>Quote</h1>
      <div className="panel">
        <SpreadScale expected={quote.expectedBps} worst={quote.worstBps} penalty={quote.penalty} />
      </div>
      <dl className="sheet spaced">
        <dt>Quote id</dt>
        <dd className="num">{quote.id} <button className="btn secondary" type="button" onClick={() => { void navigator.clipboard.writeText(quote.id).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy"}</button></dd>
        <dt>Dry</dt><dd>{quote.dry ? "true" : "false"}</dd>
        <dt>Deposit address</dt><dd>{quote.depositAddress}</dd>
        <dt>Amount in</dt><dd className="num">{quote.amountIn}</dd>
        <dt>Minimum amount in</dt><dd className="num">{quote.minAmountIn}</dd>
        <dt>Amount out</dt><dd className="num">{quote.amountOut}</dd>
        <dt>Expected spread</dt><dd className="num">{formatBps(quote.expectedBps)} ({quote.expectedBps} bps)</dd>
        <dt>Worst-case spread</dt><dd className="num">{formatBps(quote.worstBps)} ({quote.worstBps} bps)</dd>
      </dl>
      <ol className="rail">
        {STATES.map((state) => <li key={state} data-on={state === "Not started" ? "true" : "false"}>{state}</li>)}
      </ol>
      <div className="aside">
        {rejected ? (
          <Notice tone="warn" title="The enclave would reject this quote">Worst-case spread is not below the penalty you entered. Nothing was executed.</Notice>
        ) : (
          <Notice title="Price only">Expected spread uses minimum amount in. Worst-case spread uses amount in. The vault will not execute a dry quote.</Notice>
        )}
      </div>
    </>
  );
}
