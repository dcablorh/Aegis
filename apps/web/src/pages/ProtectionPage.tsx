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

  return (
    <>
      <h1>Protection</h1>
      <p className="lede">
        These three numbers stay off the chain. The page builds a commitment and ciphertext for the current testnet enclave key.
        It does not call the vault. Registering the policy requires a signed transaction, which this build does not send.
      </p>
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
      <div style={{ marginTop: 16 }}>
        <Button onClick={onPrepare}>Prepare policy locally</Button>
      </div>
      {error ? <Section title="Check"><Notice tone="error" title="The policy was not prepared">{error}</Notice></Section> : null}
      {prepared ? (
        <Section title="Local result">
          <dl>
            <dt>Commitment</dt>
            <dd className="num">{prepared.commitment}</dd>
            <dt>Salt</dt>
            <dd className="num">{prepared.salt}</dd>
            <dt>Enclave key</dt>
            <dd className="num">{ENCLAVE_X25519_HEX}</dd>
          </dl>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Ciphertext</label>
            <textarea readOnly value={prepared.ciphertext} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Notice title="Not submitted">
              The ciphertext is in this browser only. The vault still has no record of it, and no approval was requested.
            </Notice>
          </div>
        </Section>
      ) : null}
    </>
  );
}
