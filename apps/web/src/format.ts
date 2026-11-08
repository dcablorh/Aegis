export function formatUnits(raw: string, decimals: number, fraction = 4): string {
  if (!/^\d+$/.test(raw)) return raw;
  const negative = false;
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(raw);
  const whole = value / scale;
  const rest = value % scale;
  if (fraction === 0 || rest === 0n) return `${negative ? "-" : ""}${whole.toString()}`;
  const digits = rest.toString().padStart(decimals, "0").slice(0, fraction).replace(/0+$/, "");
  return digits.length === 0 ? whole.toString() : `${whole.toString()}.${digits}`;
}

export function formatHf(bps: bigint): string {
  const whole = bps / 10_000n;
  const frac = (bps % 10_000n).toString().padStart(4, "0").slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = Math.abs(bps % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

export function shortId(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 14)}…${value.slice(-10)}`;
}
