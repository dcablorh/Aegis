import { useState } from "react";
import { commitmentHash, encryptPolicy, hexToBytes, randomBytes } from "@aegis/shared-types";
import { ENCLAVE_X25519_HEX } from "../config";
import { Button, Field, Notice, Section } from "../ui";

interface Prepared {
  commitment: string;
  ciphertext: string;
  salt: string;
}

function bps(human: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(human)) return null;
  const [whole, frac = ""] = human.split(".");
  const padded = (frac + "00").slice(0, 2);
  return Number(whole) * 10_000 + Number(padded) * 100;
}

export function ProtectionPage() {
  const [minimum, setMinimum] = useState("1.08");
  const [target, setTarget] = useState("1.25");
  const [slippage, setSlippage] = useState("35");
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  function onPrepare() {
    const hfMin = bps(minimum);
    const hfTarget = bps(target);
    const slip = Number(slippage);
    if (hfMin === null || hfMin < 10_500 || hfMin > 12_000) {
      setError("Minimum health must be between 1.05 and 1.20.");
      setPrepared(null);
      return;
    }
    if (hfTarget === null || hfTarget < 12_000 || hfTarget > 14_000 || hfTarget <= hfMin) {
      setError("Target health must be between 1.20 and 1.40, and above the minimum.");
      setPrepared(null);
      return;
    }
    if (!Number.isInteger(slip) || slip < 1 || slip > 100) {
      setError("Maximum swap cost must be a whole number of basis points from 1 to 100.");
      setPrepared(null);
      return;
    }
    const salt = [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const policy = { hf_min_bps: hfMin, hf_target_bps: hfTarget, max_slippage_bps: slip, salt_hex: salt };
    setError(null);
    setPrepared({
      commitment: commitmentHash(policy),
      ciphertext: encryptPolicy(policy, hexToBytes(ENCLAVE_X25519_HEX), randomBytes(32), randomBytes(12)),
      salt,
    });
  }

  const minHf = draftHf(minimum);
  const targetHf = draftHf(target);
  const slip = Number(slippage);
  const slipOk = Number.isInteger(slip) && slip >= 1 && slip <= 100;

  return (
    <>
      <p className="kicker">Policy</p>
      <h1>Protection</h1>
      <p className="lede">
        These three numbers stay off the chain. The page builds a commitment and ciphertext for the current testnet enclave key.
        It does not call the vault. Registering the policy requires a signed transaction, which this build does not send.
      </p>
      <div className="panel">
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
        </div>
        <DraftBand minimum={minHf} target={targetHf} />
        <div className="aside">
          <span>Swap cost of this draft</span>
          <div className="meter" role="img" aria-label={slipOk ? `${slip} of 100 basis points` : "Swap cost is not a valid basis-point value"}>
            <i style={{ width: slipOk ? `${slip}%` : "0%" }} />
          </div>
        </div>
        <div className="aside">
          <Button onClick={onPrepare}>Prepare policy locally</Button>
        </div>
      </div>
      {error ? <Section title="Check"><Notice tone="error" title="The policy was not prepared">{error}</Notice></Section> : null}
      {prepared ? (
        <Section title="Local result">
          <dl className="sheet">
            <dt>Commitment</dt>
            <dd className="num">{prepared.commitment}</dd>
            <dt>Salt</dt>
            <dd className="num">{prepared.salt}</dd>
            <dt>Enclave key</dt>
            <dd className="num">{ENCLAVE_X25519_HEX}</dd>
          </dl>
          <div className="field aside">
            <span>Ciphertext</span>
            <textarea readOnly value={prepared.ciphertext} />
          </div>
          <div className="aside">
            <Notice title="Not submitted">
              The ciphertext is in this browser only. The vault still has no record of it, and no approval was requested.
            </Notice>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function draftHf(human: string): number | null {
  const value = bps(human);
  return value === null ? null : value / 10_000;
}

function DraftBand({ minimum, target }: { minimum: number | null; target: number | null }) {
  const min = 1;
  const max = 1.5;
  const place = (value: number) => `${((value - min) / (max - min)) * 100}%`;
  return (
    <figure className="band">
      <div className="band-track" role="img" aria-label="Draft policy band from 1.00 to 1.50. Shaded region is the allowed entry range.">
        <span className="band-allowed" style={{ left: place(1.05), width: `calc(${place(1.4)} - ${place(1.05)})` }} />
        {minimum !== null ? <span className="band-tick" style={{ left: place(Math.min(max, Math.max(min, minimum))) }}><span>Min {minimum.toFixed(2)}</span></span> : null}
        {target !== null ? <span className="band-tick" style={{ left: place(Math.min(max, Math.max(min, target))) }}><span>Target {target.toFixed(2)}</span></span> : null}
      </div>
      <div className="band-axis num"><span>1.00</span><span>1.50</span></div>
      <figcaption className="aside">Shaded region is the allowed entry range. Ticks follow this draft and are not registered.</figcaption>
    </figure>
  );
}
