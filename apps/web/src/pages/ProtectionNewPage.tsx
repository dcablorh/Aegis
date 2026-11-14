import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { commitmentHash, encryptPolicy, hexToBytes, randomBytes } from "@aegis/shared-types";
import { BASE_USDC, ENCLAVE_X25519_HEX, NEAR_USDC } from "../config";
import { bps, validatePolicy } from "../lib/policy";
import { rememberDraft } from "../lib/session";
import { Button, Field, Notice } from "../ui";

const STEPS = ["Position", "Conditions", "Action", "Execution", "Review", "Confirm"];

export function ProtectionNewPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [accountId, setAccountId] = useState(search.get("account") ?? "");
  const [minimum, setMinimum] = useState("1.08");
  const [target, setTarget] = useState("1.25");
  const [slippage, setSlippage] = useState("35");
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
      {step === 0 ? (
        <Field label="Burrow account" hint="The draft names this account. It does not register the policy to it.">
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} spellCheck={false} />
        </Field>
      ) : null}
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
            <p className="aside">Ticks follow this draft. The shaded range is what the form accepts. Nothing is registered.</p>
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <>
          <div className="choice"><strong>Repay debt</strong><p>The path the enclave signs when health is through the private floor. This draft does not ask it to sign.</p></div>
          <div className="choice"><strong>Add collateral</strong><p>A defined action tag. This build does not configure it.</p></div>
          <div className="choice"><strong>Local fallback swap</strong><p>Ref Finance is an allowed recipient. This build does not build that swap.</p></div>
        </>
      ) : null}
      {step === 3 ? (
        <dl className="sheet">
          <dt>Origin asset</dt><dd>Base USDC, {BASE_USDC}</dd>
          <dt>Destination asset</dt><dd>NEAR USDC, {NEAR_USDC}</dd>
          <dt>Quote mode</dt><dd>dry: true. A live quote is requested from Activity, not from this step.</dd>
          <dt>Enclave key</dt><dd className="num">{ENCLAVE_X25519_HEX}</dd>
        </dl>
      ) : null}
      {step === 4 ? (
        <dl className="sheet">
          <dt>Account</dt><dd>{accountId}</dd>
          <dt>Minimum</dt><dd className="num">{minimum}</dd>
          <dt>Target</dt><dd className="num">{target}</dd>
          <dt>Swap cap</dt><dd className="num">{slippage} bps</dd>
          <dt>Action</dt><dd>Repay debt, described only</dd>
          <dt>Submission</dt><dd>None. Confirm writes the ciphertext in this browser.</dd>
        </dl>
      ) : null}
      {step === 5 ? (
        <Notice title="Not a transaction">Confirm prepares the commitment and ciphertext locally. The vault is not called and no wallet is opened.</Notice>
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
