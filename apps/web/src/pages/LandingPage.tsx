import { useState } from "react";
import { Link } from "react-router";
import { HealthScale, Mark, SpreadScale, Wordmark } from "../ui";
import { VAULT_TESTNET, SAMPLE_ACCOUNT, ENCLAVE_X25519_HEX } from "../config";

interface Scenario {
  name: string;
  wNearPrice: number;
  debtUsd: number;
  targetHf: number;
  description: string;
}

const PRESET_SCENARIOS: Scenario[] = [
  {
    name: "Documented Baseline (1.07)",
    wNearPrice: 4.28,
    debtUsd: 2400,
    targetHf: 1.25,
    description: "The audited hackathon example: 1,000 wNEAR against 2,400 USDC debt. Health factor sits at 1.07, safely above the 1.00 liquidation line but inside the 1.08 enclave trigger zone.",
  },
  {
    name: "High Stress (1.02)",
    wNearPrice: 4.08,
    debtUsd: 2400,
    targetHf: 1.25,
    description: "Collateral dropped ~4.7%. Health factor reaches 1.02. Without confidential protection, MEV searchers would prepare liquidation bots. Enclave computes a larger debt repayment.",
  },
  {
    name: "Mild Drift (1.10)",
    wNearPrice: 4.40,
    debtUsd: 2400,
    targetHf: 1.25,
    description: "Position health is 1.10, above the 1.08 trigger floor. The enclave evaluates the condition and outputs ACTION: NONE, preserving user capital without spending swap fees.",
  },
  {
    name: "Conservative Target (1.05)",
    wNearPrice: 4.20,
    debtUsd: 2400,
    targetHf: 1.20,
    description: "Target restored to a conservative 1.20 buffer. Sizing adjusts to repay exactly the debt required to achieve the user-configured post-rescue solvency level.",
  },
];

const STEPS = [
  ["Read a position", "A public Burrow view. Available in the app.", "/app/positions"],
  ["Define conditions", "A local draft of the private floor, target, and swap cap. Not submitted.", "/app/protection/new"],
  ["Price liquidity", "A live 1Click quote with dry set to true. No deposit.", "/app/activity/new"],
  ["Check the recipient", "The deployed vault allowlist. evil.near is refused.", "/app/security"],
] as const;

const PRODUCTION_ROADMAP = [
  "Direct wallet transaction signing for on-chain register_policy.",
  "Automated keeper trigger upon incoming Pyth/OutLayer signed feed.",
  "Cross-chain non-dry settlement with Burrow debt reduction.",
];

const WORKFLOW_STAGES = [
  {
    num: "01",
    title: "Position Read & Trigger",
    actor: "Keeper → Vault Contract",
    gas: "100 Tgas attached",
    desc: "A registered keeper monitors Burrow positions via public RPC view (get_account). When signed oracle feeds indicate collateral stress, the keeper calls trigger_solvency_check with the position snapshot and fresh signed price feed.",
    invariants: "Asserts caller is registered keeper, oracle age <= 60s, feed signed by pinned oracle key, borrower lock is Idle.",
    outcome: "Vault sets lock to InFlight(request_id) and issues a cross-contract Promise to OutLayer request_execution.",
  },
  {
    num: "02",
    title: "Confidential Enclave Evaluation",
    actor: "OutLayer TEE (wasm32-wasip2)",
    gas: "10.4M WASM instructions",
    desc: "Running inside Intel TDX hardware memory, the enclave decrypts the borrower's policy using its static X25519 secret and ChaCha20-Poly1305. It checks that the decrypted parameters match the on-chain SHA-256 commitment hash.",
    invariants: "Zero plaintext leakage. Rejects commitment mismatches with ERR_COMMITMENT_MISMATCH.",
    outcome: "Enclave verifies that the decrypted policy was committed on-chain, preventing forged or swapped parameters.",
  },
  {
    num: "03",
    title: "Quantitative Solvency Sizing",
    actor: "Enclave Math Engine",
    gas: "Deterministic integer arithmetic",
    desc: "The enclave computes position health from raw token units and weights. It calculates realized price volatility from the feed history to evaluate the dynamic trigger: HF_trigger = max(HF_min, 1.02 + 2.33 * σ * √(τ)).",
    invariants: "Uses micro-USD and basis points. No floating-point rounding drift across architectures.",
    outcome: "If health is below trigger, calculates exact debt to repay: x = w * (B_adj - C_adj / HF_target), rounded up.",
  },
  {
    num: "04",
    title: "Solver Sourcing & Arbitrage Guard",
    actor: "NEAR Intents (1Click API)",
    gas: "HTTP via wasi-http-client",
    desc: "The enclave queries 1Click (swapType: EXACT_OUTPUT, amount: repay_raw). It parses minAmountIn and applies the arbitrage guard: solver spread must not exceed borrower max_slippage_bps AND must be strictly below the liquidation penalty avoided.",
    invariants: "Guarantees that executing the rescue costs less than the liquidation penalty it avoids.",
    outcome: "Outputs EnclaveRescueDecision signed with Ed25519 over the domain-separated aegis-decision-v1 message.",
  },
  {
    num: "05",
    title: "Ticket Minting & Callback",
    actor: "Vault on_enclave_decision",
    gas: "30 Tgas static callback",
    desc: "OutLayer returns the decision through a private callback. The vault verifies the enclave Ed25519 signature and the pinned WASM attestation SHA-256 hash. If the quote is valid and non-dry, an ApprovedRescueTicket is minted with a 5-minute expiry.",
    invariants: "Non-panicking release architecture: any failure or rejection frees the lock and logs the reason.",
    outcome: "Ticket state initialized to PendingDeposit. Lock remains held so no second rescue can interfere.",
  },
  {
    num: "06",
    title: "Execution & Burrow Debt Drop",
    actor: "Keeper → Position Sub-Account",
    gas: "60 Tgas send + 180 Tgas repay",
    desc: "The keeper calls execute_approved_rescue. The borrower's position sub-account transfers the reserve token strictly to the deposit address inside the signed ticket. 1Click solvers deliver target tokens to Burrow, crediting the loan and clearing the lock to Idle.",
    invariants: "Asserts recipient matches deposit_account in ticket. Settle only after Burrow confirms repayment.",
    outcome: "State reaches Success. Borrower's position debt falls, health factor returns to 1.25, and lock returns to Idle.",
  },
];

interface StateTransition {
  state: string;
  badge: string;
  trigger: string;
  precondition: string;
  mutation: string;
  guarantee: string;
  gas: string;
}

const STATE_TRANSITIONS: StateTransition[] = [
  {
    state: "01. Idle State",
    badge: "BORROWER IDLE",
    trigger: "Borrower calls register_policy or after terminal settlement",
    precondition: "SHA-256 commitment matches sha256(plaintext). Ciphertext length <= 512 bytes.",
    mutation: "rescue_lock = None. Borrower registered in policies lookup table.",
    guarantee: "No capital locked. Parameters completely invisible to on-chain observers.",
    gas: "12 Tgas storage registration",
  },
  {
    state: "02. In-Flight Execution",
    badge: "LOCK HELD",
    trigger: "Keeper calls trigger_solvency_check(borrower, snapshot, feed)",
    precondition: "Caller is authorized keeper. Oracle age <= 60s. Valid Ed25519 oracle signature. Lock is Idle.",
    mutation: "rescue_lock = InFlight(request_id, timestamp). Dispatches Promise to OutLayer TEE.",
    guarantee: "Single-inflight guarantee: no duplicate triggers or race conditions can occur.",
    gas: "100 Tgas cross-contract dispatch",
  },
  {
    state: "03. Approved Rescue Ticket",
    badge: "TICKET ACTIVE (300s)",
    trigger: "OutLayer invokes private on_enclave_decision callback",
    precondition: "Callback predecessor == vault. Ed25519 signature valid. WASM hash matches pinned enclave.",
    mutation: "tickets[id] = ApprovedRescueTicket(PendingDeposit). Lock remains held.",
    guarantee: "Temporary swap deposit address whitelisted solely for this ticket and caller.",
    gas: "30 Tgas verification callback",
  },
  {
    state: "04. Settled & Discharged",
    badge: "TERMINAL SUCCESS",
    trigger: "Keeper reports SUCCESS after Burrow confirms repay",
    precondition: "Ticket in PendingDeposit. Exact repay amount credited to borrower's Burrow position.",
    mutation: "tickets[id] = Success. rescue_lock = None (cleared to Idle).",
    guarantee: "Lock unconditionally cleared. Clean audit trail recorded for verification.",
    gas: "180 Tgas execution & settlement",
  },
];

const ATTESTATION_LAYERS = [
  {
    layer: "Layer 1: Confidential Parameter Storage",
    tech: "Client-Side X25519 + ChaCha20-Poly1305",
    desc: "The borrower's private liquidation tripwire (min HF, target HF, slippage tolerance) is encrypted in the client browser using the enclave's public key. The NEAR blockchain receives only a 32-byte SHA-256 commitment and the encrypted ciphertext.",
    audit: "Byte-scan verified: zero plaintext numbers exist on-chain.",
  },
  {
    layer: "Layer 2: Dual-Layer Oracle Verification",
    tech: "Ed25519 Signed Feed + 60s Staleness Boundary",
    desc: "Price feeds contain micro-USD valuations with unix timestamps. The vault verifies the Ed25519 signature against the pinned oracle key on-chain. The enclave independently re-verifies timestamps inside TEE memory before sizing calculations.",
    audit: "Rejects stale feeds (>60s) or invalid signatures with ERR_STALE_ORACLE.",
  },
  {
    layer: "Layer 3: Hardware Enclave Execution",
    tech: "Intel TDX Hardware TEE (wasm32-wasip2)",
    desc: "The enclave decrypts the policy inside isolated enclave memory and computes deterministic integer sizing. It outputs an EnclaveRescueDecision cryptographically signed with the enclave's hardware Ed25519 key over the aegis-decision-v1 domain.",
    audit: "WASM bytecode hash pinned to 6323745e22be3969... on the vault.",
  },
  {
    layer: "Layer 4: Restricted Allowlist & One-Shot Destination",
    tech: "Dynamic In-Ticket Recipient Whitelisting",
    desc: "The vault strictly enforces is_recipient_allowed. Arbitrary addresses (such as evil.near) are permanently refused. The dynamic 1Click swap deposit address is whitelisted exclusively for the duration of the signed ticket and cannot be reused.",
    audit: "Unauthorized transfers panic immediately with ERR_UNAUTHORIZED_RECIPIENT.",
  },
];

const TESTNET_CALL_MATRIX = [
  {
    step: "1. Policy Verification",
    contract: "vault.aegis-cloud-319903.testnet",
    method: "get_policy(borrower1...)",
    gas: "Read-only view",
    validation: "Returns 32-byte commitment hash and ciphertext.",
  },
  {
    step: "2. Solvency Trigger",
    contract: "vault.aegis-cloud-319903.testnet",
    method: "trigger_solvency_check",
    gas: "100 Tgas",
    validation: "Asserts keeper authorization, oracle age <=60s, sets lock to InFlight.",
  },
  {
    step: "3. TEE Sizing & Quote",
    contract: "aegis-cloud-319903.testnet/aegis",
    method: "OutLayer request_execution",
    gas: "10.4M WASM instructions",
    validation: "Intel TDX execution; decrypts policy, sizes 345.60 USDC, signs decision.",
  },
  {
    step: "4. Enclave Callback",
    contract: "vault.aegis-cloud-319903.testnet",
    method: "on_enclave_decision",
    gas: "30 Tgas",
    validation: "Verifies Ed25519 signature & pinned WASM hash; mints rescue ticket.",
  },
  {
    step: "5. Reserve Transfer",
    contract: "position1.aegis-cloud-319903.testnet",
    method: "execute_approved_rescue",
    gas: "60 Tgas",
    validation: "Transfers 345.95 fake USDC strictly to ticket deposit address.",
  },
  {
    step: "6. Loan Settlement",
    contract: "vault.aegis-cloud-319903.testnet",
    method: "settle_rescue(ticket_id, SUCCESS)",
    gas: "180 Tgas",
    validation: "Validates repayment confirmation, clears borrower lock to Idle.",
  },
];

export function LandingPage() {
  const [activeScenario, setActiveScenario] = useState<number>(0);
  const [customPrice, setCustomPrice] = useState<number>(4.28);
  const [customDebt, setCustomDebt] = useState<number>(2400);
  const [customTarget, setCustomTarget] = useState<number>(1.25);
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [activeStateIndex, setActiveStateIndex] = useState<number>(0);

  const price = isCustomMode ? customPrice : PRESET_SCENARIOS[activeScenario].wNearPrice;
  const debt = isCustomMode ? customDebt : PRESET_SCENARIOS[activeScenario].debtUsd;
  const target = isCustomMode ? customTarget : PRESET_SCENARIOS[activeScenario].targetHf;

  const COLLATERAL_AMOUNT = 1000;
  const COLLATERAL_WEIGHT = 0.60;
  const BORROW_WEIGHT = 1.00;

  const grossCollateral = COLLATERAL_AMOUNT * price;
  const adjCollateral = grossCollateral * COLLATERAL_WEIGHT;
  const adjBorrow = debt / BORROW_WEIGHT;
  const hf = adjCollateral / adjBorrow;
  const triggerFloor = 1.08;

  const neededBorrow = adjCollateral / target;
  const repayUsd = hf < triggerFloor ? Math.max(0, adjBorrow - neededBorrow) : 0;
  const postHf = repayUsd > 0 ? adjCollateral / (adjBorrow - repayUsd) : hf;

  const stressHf = hf * 0.80;
  const penaltySavedBps = stressHf < 1.00 ? Math.round(((1.00 - stressHf) / 2) * 10000) : 0;
  const penaltySavedUsd = debt * (penaltySavedBps / 10000);
  const solverSpreadBps = 10;
  const solverCostUsd = repayUsd * (solverSpreadBps / 10000);
  const netSavedUsd = Math.max(0, penaltySavedUsd - solverCostUsd);

  const applyPreset = (index: number) => {
    setActiveScenario(index);
    setIsCustomMode(false);
  };

  const selectedState = STATE_TRANSITIONS[activeStateIndex];

  return (
    <div className="landing" id="content">
      {/* Top Navigation */}
      <header className="land-top">
        <Link className="side-brand" to="/">
          <Mark />
          <Wordmark />
        </Link>
        <nav aria-label="Public">
          <a href="#problem">The problem</a>
          <a href="#simulator">Model</a>
          <a href="#workflow">Lifecycle</a>
          <a href="#state-machine">State machine</a>
          <a href="#architecture">Architecture</a>
          <a href="#security">Security</a>
          <Link to="/app">Enter the app</Link>
        </nav>
      </header>

      {/* Hero Section: Matches docs/images/app-screenshot.png */}
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

      {/* Section 1: The Problem — Matches docs/images/app-screenshot.png */}
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

      {/* Section 2: Interactive Financial Model & Sizing Explorer */}
      <section className="land-block" id="simulator">
        <p className="kicker">Solvency model</p>
        <h2>Integer debt sizing & arbitrage guard.</h2>
        <p className="lede">
          The enclave sizes repayment to satisfy C_adj / (B_adj - x / w) = target_HF. The swap is approved only when the solver spread is strictly below the liquidation penalty saved.
        </p>

        <div className="panel">
          <div className="filters" style={{ marginTop: 0, marginBottom: "16px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>
              Presets:
            </span>
            {PRESET_SCENARIOS.map((s, idx) => (
              <button
                key={s.name}
                type="button"
                className={`choice ${!isCustomMode && activeScenario === idx ? "selected" : ""}`}
                style={{ padding: "4px 10px", fontSize: "12px", cursor: "pointer", border: !isCustomMode && activeScenario === idx ? "1px solid var(--accent)" : "1px solid var(--line)" }}
                onClick={() => applyPreset(idx)}
              >
                {s.name}
              </button>
            ))}
            <button
              type="button"
              className={`choice ${isCustomMode ? "selected" : ""}`}
              style={{ padding: "4px 10px", fontSize: "12px", cursor: "pointer", border: isCustomMode ? "1px solid var(--accent)" : "1px solid var(--line)" }}
              onClick={() => setIsCustomMode(true)}
            >
              Manual adjustments
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", marginBottom: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <label className="field">
                <span>wNEAR Collateral Price: <b className="num">${price.toFixed(2)}</b></span>
                <input
                  type="range"
                  min="3.00"
                  max="6.00"
                  step="0.02"
                  value={price}
                  onChange={(e) => {
                    setCustomPrice(parseFloat(e.target.value));
                    setIsCustomMode(true);
                  }}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
                <span className="hint">1,000 wNEAR collateral with 60% Burrow volatility ratio</span>
              </label>

              <label className="field">
                <span>USDC Borrowed Liability: <b className="num">${debt.toFixed(0)}</b></span>
                <input
                  type="range"
                  min="1600"
                  max="3200"
                  step="50"
                  value={debt}
                  onChange={(e) => {
                    setCustomDebt(parseFloat(e.target.value));
                    setIsCustomMode(true);
                  }}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
                <span className="hint">100% borrow weight against Burrow USDC market</span>
              </label>

              <label className="field">
                <span>Target Solvency Buffer: <b className="num">{target.toFixed(2)}</b></span>
                <input
                  type="range"
                  min="1.15"
                  max="1.40"
                  step="0.05"
                  value={target}
                  onChange={(e) => {
                    setCustomTarget(parseFloat(e.target.value));
                    setIsCustomMode(true);
                  }}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
                <span className="hint">Target health factor restored following debt repayment</span>
              </label>
            </div>

            <div>
              <table className="data">
                <thead>
                  <tr>
                    <th>Metric & Parameters</th>
                    <th style={{ textAlign: "right" }}>Computed Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Burrow Collateral Adjusted</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>1,000 wNEAR × ${price.toFixed(2)} × 60% volatility weight</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle" }}>${adjCollateral.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Borrow Liability Adjusted</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>${debt.toFixed(0)} USDC liability / 100% borrow weight</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle" }}>${adjBorrow.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Observed Health Factor</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Adjusted collateral divided by adjusted debt</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle", fontWeight: 700, color: hf <= 1.00 ? "var(--danger)" : hf <= triggerFloor ? "var(--mark)" : "var(--accent)" }}>
                      {hf.toFixed(4)}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Enclave Evaluation</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Tested against dynamic trigger floor (1.0800)</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle", fontWeight: 650 }}>
                      {hf <= triggerFloor ? "REPAY_DEBT" : "ACTION_NONE (Solvent)"}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Required Debt Repayment</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Exact sizing to restore target buffer ({target.toFixed(2)})</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle", fontWeight: 700, color: "var(--accent)" }}>
                      {repayUsd > 0 ? `${repayUsd.toFixed(2)} USDC` : "0.00 USDC"}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Post-Rescue Health Buffer</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Projected solvency factor after Burrow debt repayment</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle" }}>{postHf.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Liquidation Penalty Avoided</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Half-shortfall penalty saved under 20% stress drop</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle", color: "var(--mark)" }}>
                      {penaltySavedBps} bps (${penaltySavedUsd.toFixed(2)})
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ fontWeight: 600, display: "block" }}>Net Capital Preserved</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>Liquidation penalty avoided minus 10 bps solver spread</span>
                    </td>
                    <td className="num" style={{ textAlign: "right", verticalAlign: "middle", fontWeight: 700, color: "var(--accent)" }}>
                      {repayUsd > 0 ? `+$${netSavedUsd.toFixed(2)} USDC` : "No liquidation risk"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p className="kicker" style={{ marginTop: "16px" }}>Solver spread vs. liquidation discount guard</p>
          <SpreadScale expected={10} worst={100} penalty={penaltySavedBps || 720} />
          <p className="aside">
            The enclave checks that the worst-case quote ({100} bps) is strictly below the penalty avoided ({penaltySavedBps || 720} bps).
            If the solver spread exceeds the penalty saved, the rescue is refused to protect the borrower from unprofitable execution.
          </p>
        </div>
      </section>

      {/* Section 3: How it Works — Matches docs/images/app-screenshot.png */}
      <section className="land-block" id="how">
        <p className="kicker">Protocol workflow</p>
        <h2>Interface capabilities & on-chain boundaries.</h2>
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
          <h3>Production Execution Pipeline</h3>
          <ul className="plain">
            {PRODUCTION_ROADMAP.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      {/* Section 4: Complex Multi-Stage Execution Lifecycle */}
      <section className="land-block" id="workflow">
        <p className="kicker">Protocol mechanics</p>
        <h2>Six-stage verifiable execution lifecycle.</h2>
        <p className="lede">
          From price monitoring to on-chain settlement, execution is partitioned across strict trust boundaries to guarantee no stuck locks and zero plaintext exposure.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {WORKFLOW_STAGES.map((s) => (
            <div key={s.num} className="panel" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  <span className="num" style={{ color: "var(--mark)", fontWeight: 700, fontSize: "14px" }}>{s.num}</span>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 650 }}>{s.title}</h3>
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "12px" }}>
                  <span style={{ color: "var(--faint)" }}>{s.actor}</span>
                  <span className="num" style={{ color: "var(--muted)" }}>{s.gas}</span>
                </div>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: "14px", color: "var(--ink)", lineHeight: 1.5 }}>{s.desc}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "12.5px", paddingTop: "8px", borderTop: "1px solid var(--line)" }}>
                <div>
                  <span style={{ color: "var(--faint)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.05em", display: "block" }}>Constraint</span>
                  <span style={{ color: "var(--muted)" }}>{s.invariants}</span>
                </div>
                <div>
                  <span style={{ color: "var(--faint)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.05em", display: "block" }}>Output State</span>
                  <span style={{ color: "var(--accent)", fontWeight: 500 }}>{s.outcome}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 5: State Machine & Lock Transition Inspector */}
      <section className="land-block" id="state-machine">
        <p className="kicker">Deterministic state machine</p>
        <h2>Borrower lock transitions & terminal states.</h2>
        <p className="lede">
          The vault enforces a strict single-flight lock per borrower. An in-flight lock cannot be superseded, and every terminal outcome—whether success, refund, or rejection—guarantees lock release.
        </p>

        <div className="panel">
          <div className="filters" style={{ marginTop: 0, marginBottom: "16px" }}>
            <span style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600 }}>
              Lifecycle Phase:
            </span>
            {STATE_TRANSITIONS.map((st, idx) => (
              <button
                key={st.state}
                type="button"
                className={`choice ${activeStateIndex === idx ? "selected" : ""}`}
                style={{ padding: "4px 10px", fontSize: "12px", cursor: "pointer", border: activeStateIndex === idx ? "1px solid var(--accent)" : "1px solid var(--line)" }}
                onClick={() => setActiveStateIndex(idx)}
              >
                {st.state}
              </button>
            ))}
          </div>

          <div style={{ border: "1px solid var(--line)", padding: "18px 20px", borderRadius: "4px", background: "var(--surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--line)", paddingBottom: "10px" }}>
              <span className="num" style={{ fontWeight: 700, fontSize: "15px" }}>{selectedState.state}</span>
              <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "3px", background: "var(--accent-soft)", color: "var(--accent)" }}>
                {selectedState.badge}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "13px" }}>
              <div>
                <span style={{ color: "var(--faint)", textTransform: "uppercase", fontSize: "10.5px", letterSpacing: "0.04em", display: "block", marginBottom: "3px" }}>
                  Invocation Trigger
                </span>
                <p style={{ margin: 0, color: "var(--ink)" }}>{selectedState.trigger}</p>
              </div>

              <div>
                <span style={{ color: "var(--faint)", textTransform: "uppercase", fontSize: "10.5px", letterSpacing: "0.04em", display: "block", marginBottom: "3px" }}>
                  Precondition Assertion
                </span>
                <p style={{ margin: 0, color: "var(--ink)" }}>{selectedState.precondition}</p>
              </div>

              <div>
                <span style={{ color: "var(--faint)", textTransform: "uppercase", fontSize: "10.5px", letterSpacing: "0.04em", display: "block", marginBottom: "3px" }}>
                  On-Chain State Mutation
                </span>
                <p style={{ margin: 0, color: "var(--accent)", fontWeight: 500 }}>{selectedState.mutation}</p>
              </div>

              <div>
                <span style={{ color: "var(--faint)", textTransform: "uppercase", fontSize: "10.5px", letterSpacing: "0.04em", display: "block", marginBottom: "3px" }}>
                  Security & Release Guarantee
                </span>
                <p style={{ margin: 0, color: "var(--muted)" }}>{selectedState.guarantee}</p>
              </div>
            </div>

            <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--muted)" }}>
              <span>Execution Cost Budget:</span>
              <span className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{selectedState.gas}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 6: Cryptographic Attestation Pipeline */}
      <section className="land-block" id="attestation">
        <p className="kicker">Cryptographic attestation</p>
        <h2>Four-layer defense boundary.</h2>
        <p className="lede">
          AegisMargin eliminates trust in intermediaries by distributing verification across client cryptography, hardware enclaves, signed oracle feeds, and contract assertions.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
          {ATTESTATION_LAYERS.map((layer) => (
            <div key={layer.layer} className="panel" style={{ padding: "18px 20px" }}>
              <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--mark)", fontWeight: 650, display: "block", marginBottom: "4px" }}>
                {layer.layer}
              </span>
              <h3 style={{ margin: "0 0 8px", fontSize: "15px", fontWeight: 600 }}>{layer.tech}</h3>
              <p style={{ margin: "0 0 12px", fontSize: "13.5px", color: "var(--ink)", lineHeight: 1.5 }}>{layer.desc}</p>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: "8px", fontSize: "12px", color: "var(--muted)" }}>
                <span style={{ color: "var(--faint)", fontWeight: 600 }}>Audit Verification: </span>
                {layer.audit}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 7: Architecture & Testnet Matrix */}
      <section className="land-block" id="architecture">
        <p className="kicker">Architecture</p>
        <h2>Four roles, each with one job.</h2>
        <dl className="roles">
          <div>
            <dt>NEAR vault</dt>
            <dd>Stores the policy fingerprint and refuses recipients outside the allowlist. Deployed on testnet at <code>{VAULT_TESTNET}</code>.</dd>
          </div>
          <div>
            <dt>Burrow</dt>
            <dd>Holds the collateral and the debt. The app reads it via public RPC view. It does not move funds.</dd>
          </div>
          <div>
            <dt>OutLayer</dt>
            <dd>Runs the confidential enclave in wasip2 that opens the policy. The website only encrypts to its public key.</dd>
          </div>
          <div>
            <dt>1Click</dt>
            <dd>Prices Base USDC into NEAR USDC via NEAR Intents solvers. A dry quote returns the deposit address dry_run.</dd>
          </div>
        </dl>

        <div className="panel" style={{ marginTop: "16px" }}>
          <p className="kicker">Verified testnet call matrix (demo:verify audit)</p>
          <table className="data" style={{ marginTop: "8px" }}>
            <thead>
              <tr>
                <th>Lifecycle Step</th>
                <th>Contract Target</th>
                <th>Method Invoked</th>
                <th>Gas / Compute</th>
                <th>Contract Validation</th>
              </tr>
            </thead>
            <tbody>
              {TESTNET_CALL_MATRIX.map((c) => (
                <tr key={c.step}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.step}</td>
                  <td><code>{c.contract}</code></td>
                  <td><code>{c.method}</code></td>
                  <td className="num">{c.gas}</td>
                  <td style={{ color: "var(--muted)", fontSize: "12.5px" }}>{c.validation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ marginTop: "16px" }}>
          <p className="kicker">Testnet deployment telemetry</p>
          <table className="data" style={{ marginTop: "8px" }}>
            <thead>
              <tr>
                <th>Component</th>
                <th>Contract / Project Identifier</th>
                <th>Specification</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Vault Contract</td>
                <td><code>{VAULT_TESTNET}</code></td>
                <td>Stores commitments, asserts recipient allowlist, verifies Ed25519 signatures</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Borrower Account</td>
                <td><code>{SAMPLE_ACCOUNT}</code></td>
                <td>Sample testnet borrower with registered policy ciphertext</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Position Account</td>
                <td><code>position1.aegis-cloud-319903.testnet</code></td>
                <td>Sub-account holding Burrow loan; executes send_reserve and repay on verified ticket</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>OutLayer TEE Project</td>
                <td><code>aegis-cloud-319903.testnet/aegis</code></td>
                <td>WASM sha256 <code>6323745e22be3969...</code>, compiled for wasm32-wasip2</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Enclave Public Key</td>
                <td><code>{ENCLAVE_X25519_HEX.slice(0, 32)}...</code></td>
                <td>Static X25519 key used for client-side policy encryption</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 8: Security — Matches docs/images/app-screenshot.png */}
      <section className="land-block" id="security">
        <p className="kicker">Privacy and security</p>
        <h2>What is hidden, what is checked, what you grant.</h2>
        <div className="role-grid">
          <article>
            <h3>Hidden</h3>
            <p>The floor, the target, and the swap cap. The chain stores only a 32-byte hash and a ciphertext. This build keeps both in the browser.</p>
          </article>
          <article>
            <h3>Checked</h3>
            <p>The vault view <code>is_recipient_allowed</code>. A transfer to anyone else panics with <code>ERR_UNAUTHORIZED_RECIPIENT</code>. A deposit address is allowed only inside a signed ticket.</p>
          </article>
          <article>
            <h3>Granted here</h3>
            <p>Nothing. There is no wallet approval, no session key, and no transaction. A dry quote is a read-only price request to 1Click.</p>
          </article>
        </div>
      </section>

      {/* Footer */}
      <footer className="land-foot">
        <Link className="btn" to="/app">Enter the app</Link>
        <Link to="/app/positions">Burrow positions</Link>
        <Link to="/app/protection/new">Draft policy</Link>
        <Link to="/app/activity/new">Dry quote</Link>
        <Link to="/app/security">Allowlist check</Link>
        <a href="https://github.com/dcablorh/Aegis">Repository README</a>
        <a href={`https://testnet.nearblocks.io/address/${VAULT_TESTNET}`} target="_blank" rel="noreferrer">
          Testnet contract
        </a>
      </footer>
    </div>
  );
}
