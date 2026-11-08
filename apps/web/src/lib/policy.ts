export function bps(human: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(human)) return null;
  const [whole, frac = ""] = human.split(".");
  const padded = (frac + "00").slice(0, 2);
  return Number(whole) * 10_000 + Number(padded) * 100;
}

export function validatePolicy(minimum: string, target: string, slippage: string): string | null {
  const hfMin = bps(minimum);
  const hfTarget = bps(target);
  const slip = Number(slippage);
  if (hfMin === null || hfMin < 10_500 || hfMin > 12_000) return "Minimum health must be between 1.05 and 1.20.";
  if (hfTarget === null || hfTarget < 12_000 || hfTarget > 14_000 || hfTarget <= hfMin) {
    return "Target health must be between 1.20 and 1.40, and above the minimum.";
  }
  if (!Number.isInteger(slip) || slip < 1 || slip > 100) return "Maximum swap cost must be a whole number of basis points from 1 to 100.";
  return null;
}
