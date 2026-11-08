import type { ReactNode } from "react";

export function Mark() {
  return (
    <svg className="mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6.5 15.5v-4M11 15.5V6.5M15.5 15.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Notice({ tone, title, children }: { tone?: "error" | "warn"; title: string; children: ReactNode }) {
  return (
    <div className={tone ? `notice ${tone}` : "notice"} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="btn" type="button" {...props}>
      {children}
    </button>
  );
}

export function Pending({ label }: { label: string }) {
  return (
    <div className="panel pending" role="status">
      <span className="pending-bar" />
      <span className="pending-bar short" />
      <p>{label}</p>
    </div>
  );
}

/** Protocol scale. 1.00 is the liquidation boundary. A marker is drawn only for a calculated health factor. */
export function HealthScale({ hf }: { hf: number | null }) {
  const min = 0.8;
  const max = 1.6;
  const place = (value: number) => `${((value - min) / (max - min)) * 100}%`;
  const marker = hf === null ? null : Math.min(max, Math.max(min, hf));
  const label = hf === null
    ? "Health scale from 0.80 to 1.60. Liquidation discount applies below 1.00. No position marker."
    : `Health factor ${hf.toFixed(2)} on a scale from 0.80 to 1.60.`;
  return (
    <figure className="scale">
      <div className="scale-track" role="img" aria-label={label}>
        <span className="scale-band" style={{ left: 0, width: place(1) }} />
        {marker !== null ? <span className="scale-marker" style={{ left: place(marker) }} /> : null}
      </div>
      <div className="scale-axis num">
        <span>0.80</span>
        <span>1.00</span>
        <span>1.60</span>
      </div>
      <figcaption>
        {hf === null
          ? "The shaded band is where a liquidation discount applies. This read has no marker."
          : `Marker at ${hf.toFixed(2)}. A discount applies only below 1.00.`}
      </figcaption>
    </figure>
  );
}

/** Compares a live quote with the penalty the caller supplied. Widths are shares of the largest of the three. */
export function SpreadScale({ expected, worst, penalty }: { expected: number; worst: number; penalty: number }) {
  const max = Math.max(expected, worst, penalty, 1);
  const width = (value: number) => `${(value / max) * 100}%`;
  return (
    <div className="spread" role="img" aria-label={`Expected spread ${expected} bps, worst case ${worst} bps, penalty saved ${penalty} bps`}>
      <div className="spread-row">
        <span>Expected</span>
        <div className="spread-track">
          <i style={{ width: width(expected) }} />
          <span className="spread-line" style={{ left: width(penalty) }} />
        </div>
        <b className="num">{expected} bps</b>
      </div>
      <div className="spread-row worst">
        <span>Worst case</span>
        <div className="spread-track">
          <i style={{ width: width(worst) }} />
          <span className="spread-line" style={{ left: width(penalty) }} />
        </div>
        <b className="num">{worst} bps</b>
      </div>
      <p className="aside">The brass line is the penalty you entered, {penalty} bps. The enclave rejects a quote when the worst case is not below that line.</p>
    </div>
  );
}
