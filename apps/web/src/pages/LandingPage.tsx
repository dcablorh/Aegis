import { Link } from "react-router";
import { HealthScale, Mark, Wordmark } from "../ui";

const STEPS = [
  ["Read a position", "A public Burrow view. Available in the app.", "/app/positions"],
  ["Define conditions", "A local draft of the private floor, target, and swap cap. Not submitted.", "/app/protection/new"],
  ["Price liquidity", "A live 1Click quote with dry set to true. No deposit.", "/app/activity/new"],
  ["Check the recipient", "The deployed vault allowlist. evil.near is refused.", "/app/security"],
];

const LATER = [
  "Connect a wallet and sign register_policy.",
  "A keeper triggers the enclave when a signed price arrives.",
  "A non-dry quote, a deposit, and a Burrow repayment.",
];

export function LandingPage() {
  return (
    <div className="landing" id="content">
      <header className="land-top">
        <Link className="side-brand" to="/">
          <Mark />
          <Wordmark />
        </Link>
        <nav aria-label="Public">
          <a href="#how">How it works</a>
          <a href="#security">Security</a>
          <Link to="/app">Enter the app</Link>
        </nav>
      </header>
      <section className="hero">
        <div>
          <p className="kicker">Lending protection on NEAR</p>
          <h1>Repay a position before liquidation, without publishing the tripwire.</h1>
          <p className="lede">
            AegisMargin reads a Rhea/Burrow loan, keeps the borrower's own thresholds off the chain, and prices a cross-chain repayment with a dry-run NEAR Intents quote.
            This site does not connect a wallet and does not move tokens.
          </p>
          <div className="hero-actions">
            <Link className="btn" to="/app">Enter the app</Link>
            <a className="btn secondary" href="#how">How it works</a>
          </div>
        </div>
        <figure className="hero-figure">
          <Mark />
          <figcaption>The mark is a boundary. The inner stroke stops before the edge: intervention before liquidation.</figcaption>
        </figure>
      </section>
      <section className="land-block" id="problem">
        <p className="kicker">The problem</p>
        <h2>Liquidation is a public price and a penalty.</h2>
        <p className="lede">
          Collateral value falls, debt stays, and health factor is their ratio after risk weights. At 1.00 the position can be liquidated. The penalty in this design is half the shortfall.
          A public trigger lets anyone see how close that line is.
        </p>
        <div className="panel">
          <p className="kicker">Documented example, not a live account</p>
          <p className="figure num">1.07</p>
          <HealthScale hf={1.07} />
          <p className="aside">1000 wNEAR at $4.28, 60% weight, against 2400 USDC of debt. Repay 345.60 USDC to restore health 1.25. A 20% collateral drop would have cost 720 bps.</p>
        </div>
      </section>
      <section className="land-block" id="how">
        <p className="kicker">How it works</p>
        <h2>What you can do in this build, and what stays on the vault.</h2>
        <ol className="land-steps">
          {STEPS.map(([title, body, href], index) => (
            <li key={title}>
              <span className="num">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
              <Link to={href}>Open</Link>
            </li>
          ))}
        </ol>
        <div className="panel later">
          <h3>Designed, not available in this build</h3>
          <ul className="plain">
            {LATER.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>
      <section className="land-block" id="architecture">
        <p className="kicker">Architecture</p>
        <h2>Four roles, each with one job.</h2>
        <dl className="roles">
          <div><dt>NEAR vault</dt><dd>Stores the policy fingerprint and refuses recipients outside the allowlist.</dd></div>
          <div><dt>Burrow</dt><dd>Holds the collateral and the debt. The app reads it. It does not repay it.</dd></div>
          <div><dt>OutLayer</dt><dd>Runs the enclave that can open the policy. The website only encrypts to its public key.</dd></div>
          <div><dt>1Click</dt><dd>Prices Base USDC into NEAR USDC. A dry quote returns the deposit address dry_run.</dd></div>
        </dl>
      </section>
      <section className="land-block" id="security">
        <p className="kicker">Privacy and security</p>
        <h2>What is hidden, what is checked, what you grant.</h2>
        <div className="role-grid">
          <article>
            <h3>Hidden</h3>
            <p>The floor, the target, and the swap cap. The chain is meant to store a hash and a ciphertext. This build keeps both in the browser.</p>
          </article>
          <article>
            <h3>Checked</h3>
            <p>The vault view is_recipient_allowed. A transfer to anyone else panics with ERR_UNAUTHORIZED_RECIPIENT. A deposit address is allowed only inside a signed ticket.</p>
          </article>
          <article>
            <h3>Granted here</h3>
            <p>Nothing. There is no wallet approval, no session key, and no transaction. A dry quote is a price request to 1Click.</p>
          </article>
        </div>
      </section>
      <footer className="land-foot">
        <Link className="btn" to="/app">Enter the app</Link>
        <a href="https://github.com/dcablorh/Aegis">Repository README</a>
      </footer>
    </div>
  );
}
