import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { commitmentHash, encryptPolicy, hexToBytes, randomBytes } from "@aegis/shared-types";
import { BASE_USDC, ENCLAVE_X25519_HEX, NEAR_USDC } from "../config";
import { bps, validatePolicy } from "../lib/policy";
import { rememberDraft } from "../lib/session";
import { Button, Field, Notice } from "../ui";

const STEPS = ["Position", "Conditions", "Action", "Execution", "Review", "Confirm"];

export const AVAILABLE_ORIGIN_ASSETS = [
  { id: BASE_USDC, label: "Base USDC (nep141:base-0x833589...)" },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", label: "Arbitrum USDC (nep141:arb-0xaf88d0...)" },
  { id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", label: "Ethereum USDC (nep141:eth-0xa0b869...)" },
  { id: "nep141:sol-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.omft.near", label: "Solana USDC (nep141:sol-EPjFWd...)" },
  { id: "wrap.testnet", label: "Wrapped NEAR (wrap.testnet)" },
];

export const AVAILABLE_DESTINATION_ASSETS = [
  { id: NEAR_USDC, label: "NEAR Native USDC (nep141:17208628...)" },
  { id: "wrap.testnet", label: "Wrapped NEAR (wrap.testnet)" },
  { id: "usdt.fakes.testnet", label: "Tether USD (usdt.fakes.testnet)" },
];

export function ProtectionNewPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [accountId, setAccountId] = useState(search.get("account") ?? "position1.aegis-cloud-319903.testnet");
  const [minimum, setMinimum] = useState("1.08");
  const [target, setTarget] = useState("1.25");
  const [slippage, setSlippage] = useState("35");
  const [action, setAction] = useState<"REPAY_DEBT" | "ADD_COLLATERAL" | "LOCAL_FALLBACK_SWAP">("REPAY_DEBT");
  const [originAsset, setOriginAsset] = useState<string>(BASE_USDC);
  const [destinationAsset, setDestinationAsset] = useState<string>(NEAR_USDC);
  const [quoteMode, setQuoteMode] = useState<"dry" | "live">("dry");
  const [error, setError] = useState<string | null>(null);

  const slip = Number(slippage);
  const slipOk = Number.isInteger(slip) && slip >= 1 && slip <= 100;
  const minHf = useMemo(() => { const value = bps(minimum); return value === null ? null : value / 10_000; }, [minimum]);
  const targetHf = useMemo(() => { const value = bps(target); return value === null ? null : value / 10_000; }, [target]);

  function next() {
    if (step === 0 && accountId.trim().length === 0) {
      setError("Enter the Burrow account this draft refers to.");
      return;
    }
    if (step === 1) {
      const problem = validatePolicy(minimum, target, slippage);
      if (problem) { setError(problem); return; }
    }
    setError(null);
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  }

  function confirm() {
    const problem = validatePolicy(minimum, target, slippage);
    if (problem || accountId.trim().length === 0) { setError(problem ?? "Enter an account."); return; }
    const hfMin = bps(minimum);
    const hfTarget = bps(target);
    if (hfMin === null || hfTarget === null) return;
    const salt = [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const policy = { hf_min_bps: hfMin, hf_target_bps: hfTarget, max_slippage_bps: Number(slippage), salt_hex: salt };
    const id = crypto.randomUUID();
    rememberDraft({
      id,
      at: new Date().toISOString(),
      accountId: accountId.trim(),
      minimum,
      target,
      slippage,
      commitment: commitmentHash(policy),
      ciphertext: encryptPolicy(policy, hexToBytes(ENCLAVE_X25519_HEX), randomBytes(32), randomBytes(12)),
      salt,
      action: action === "REPAY_DEBT" ? "Repay debt" : action === "ADD_COLLATERAL" ? "Add collateral" : "Local fallback swap",
      originAsset,
      destinationAsset,
    });
    navigate(`/app/protection/drafts/${id}`);
  }

  return (
    <>
      <p className="kicker">New draft</p>
      <h1>Protection</h1>
      <ol className="stepper">
        {STEPS.map((label, index) => <li key={label} data-on={index === step ? "current" : index < step ? "done" : "todo"}>{label}</li>)}
      </ol>
      {error ? <Notice tone="error" title="Check this step">{error}</Notice> : null}
      
      {/* STEP 0: POSITION */}
      {step === 0 ? (
        <Field label="Burrow account" hint="The account holding the Burrow loan to be monitored.">
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} spellCheck={false} />
        </Field>
      ) : null}

      {/* STEP 1: CONDITIONS */}
      {step === 1 ? (
        <div className="grid-3">
          <Field label="Minimum health" hint="Trigger floor, 1.05 to 1.20.">
            <input value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Target health" hint="Level a repayment aims to restore.">
            <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Max swap cost (bps)" hint="100 bps is 1%.">
            <input value={slippage} onChange={(event) => setSlippage(event.target.value)} inputMode="numeric" />
          </Field>
          <div className="band" style={{ gridColumn: "1 / -1" }}>
            <DraftTicks minimum={minHf} target={targetHf} />
            <div className="meter" role="img" aria-label={slipOk ? `${slip} of 100 basis points` : "Swap cost is not valid"}>
              <i style={{ width: slipOk ? `${slip}%` : "0%" }} />
            </div>
            <p className="aside">Ticks follow this draft. Shaded area indicates parameter safety bounds.</p>
          </div>
        </div>
      ) : null}

      {/* STEP 2: ACTION (SELECTABLE) */}
      {step === 2 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div
            className="choice"
            onClick={() => setAction("REPAY_DEBT")}
            style={{
              cursor: "pointer",
              border: action === "REPAY_DEBT" ? "2px solid var(--accent)" : "1px solid var(--line)",
              background: action === "REPAY_DEBT" ? "var(--accent-soft)" : "transparent",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Repay debt (Primary)</strong>
              {action === "REPAY_DEBT" ? <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓ Selected</span> : null}
            </div>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13.5px" }}>
              Enclave sizes exact debt reduction and routes repayment through NEAR Intents 1Click. Directly lowers borrow liability.
            </p>
          </div>

          <div
            className="choice"
            onClick={() => setAction("ADD_COLLATERAL")}
            style={{
              cursor: "pointer",
              border: action === "ADD_COLLATERAL" ? "2px solid var(--accent)" : "1px solid var(--line)",
              background: action === "ADD_COLLATERAL" ? "var(--accent-soft)" : "transparent",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Add collateral (Emergency Deposit)</strong>
              {action === "ADD_COLLATERAL" ? <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓ Selected</span> : null}
            </div>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13.5px" }}>
              Enclave routes reserve tokens directly into Burrow collateral supply to boost the solvency ratio without retiring debt.
            </p>
          </div>

          <div
            className="choice"
            onClick={() => setAction("LOCAL_FALLBACK_SWAP")}
            style={{
              cursor: "pointer",
              border: action === "LOCAL_FALLBACK_SWAP" ? "2px solid var(--accent)" : "1px solid var(--line)",
              background: action === "LOCAL_FALLBACK_SWAP" ? "var(--accent-soft)" : "transparent",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Local fallback swap (Ref Finance)</strong>
              {action === "LOCAL_FALLBACK_SWAP" ? <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓ Selected</span> : null}
            </div>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13.5px" }}>
              On-chain secondary fallback through Ref Finance liquidity pools when cross-chain solvers cannot fulfill within the deadline.
            </p>
          </div>
        </div>
      ) : null}

      {/* STEP 3: EXECUTION (CONFIGURABLE) */}
      {step === 3 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Field label="Origin Reserve Asset (Funding Source)" hint="The token held in the borrower sub-account used to fund the rescue.">
            <select
              value={originAsset}
              onChange={(e) => setOriginAsset(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid var(--line-strong)", background: "var(--surface)" }}
            >
              {AVAILABLE_ORIGIN_ASSETS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Destination Repay Asset (Burrow Obligation)" hint="The target token credited to the Burrow position contract.">
            <select
              value={destinationAsset}
              onChange={(e) => setDestinationAsset(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid var(--line-strong)", background: "var(--surface)" }}
            >
              {AVAILABLE_DESTINATION_ASSETS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Execution Routing Mode" hint="Dry mode evaluates live pricing without transferring funds.">
            <select
              value={quoteMode}
              onChange={(e) => setQuoteMode(e.target.value as "dry" | "live")}
              style={{ width: "100%", padding: "10px", borderRadius: "4px", border: "1px solid var(--line-strong)", background: "var(--surface)" }}
            >
              <option value="dry">Dry-Run Mode (Live 1Click price discovery, zero capital movement)</option>
              <option value="live">Live Ticket Execution (Enclave issues one-shot settlement ticket)</option>
            </select>
          </Field>

          <dl className="sheet" style={{ marginTop: "8px" }}>
            <dt>Hardware Enclave</dt><dd>OutLayer TEE (Intel TDX, wasm32-wasip2)</dd>
            <dt>Enclave Public Key</dt><dd className="num">{ENCLAVE_X25519_HEX}</dd>
          </dl>
        </div>
      ) : null}

      {/* STEP 4: REVIEW */}
      {step === 4 ? (
        <dl className="sheet">
          <dt>Account</dt><dd>{accountId}</dd>
          <dt>Minimum health floor</dt><dd className="num">{minimum}</dd>
          <dt>Target restored health</dt><dd className="num">{target}</dd>
          <dt>Max slippage buffer</dt><dd className="num">{slippage} bps</dd>
          <dt>Action strategy</dt><dd>{action === "REPAY_DEBT" ? "Repay debt" : action === "ADD_COLLATERAL" ? "Add collateral" : "Local fallback swap"}</dd>
          <dt>Origin reserve</dt><dd><code>{originAsset}</code></dd>
          <dt>Destination token</dt><dd><code>{destinationAsset}</code></dd>
          <dt>Routing mode</dt><dd>{quoteMode === "dry" ? "Dry-run price check" : "Live settlement"}</dd>
        </dl>
      ) : null}

      {/* STEP 5: CONFIRM */}
      {step === 5 ? (
        <Notice title="Client-Side Cryptography">
          Clicking "Prepare locally" will perform an X25519 Diffie-Hellman key exchange and ChaCha20-Poly1305 authenticated encryption directly in your browser. The plain thresholds never leave this machine.
        </Notice>
      ) : null}

      <div className="split-actions">
        {step > 0 ? <Button className="secondary" onClick={() => { setError(null); setStep((value) => value - 1); }}>Back</Button> : <Link className="btn secondary" to="/app/protection">Cancel</Link>}
        {step < 5 ? <Button onClick={next}>Continue</Button> : <Button onClick={confirm}>Prepare locally</Button>}
      </div>
    </>
  );
}

function DraftTicks({ minimum, target }: { minimum: number | null; target: number | null }) {
  const place = (value: number) => `${((value - 1) / 0.5) * 100}%`;
  return (
    <div className="band-track" role="img" aria-label="Draft band from 1.00 to 1.50">
      <span className="band-allowed" style={{ left: place(1.05), width: `calc(${place(1.4)} - ${place(1.05)})` }} />
      {minimum !== null ? <span className="band-tick" style={{ left: place(Math.min(1.5, Math.max(1, minimum))) }}><span>Min {minimum.toFixed(2)}</span></span> : null}
      {target !== null ? <span className="band-tick" style={{ left: place(Math.min(1.5, Math.max(1, target))) }}><span>Target {target.toFixed(2)}</span></span> : null}
    </div>
  );
}
