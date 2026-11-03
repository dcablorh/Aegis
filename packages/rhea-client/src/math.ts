/** Whole-number loan maths. USD amounts are micro-USD. Ratios are basis points. Matches enclave/aegis-wasi/src/math.rs. */

const BPS = 10_000n;
const STRESS_DROP_BPS = 2_000n;

export interface PricedAsset {
  amount_raw: string;
  decimals: number;
  /** Collateral or borrow weight. Burrow's `volatility_ratio`. 10000 = 1.0. */
  weight_bps: number;
  /** Micro-USD for one whole token (1_000_000 = $1). */
  price_micro_usd: bigint;
}

export interface Health {
  collateral_adj_usd: bigint;
  borrow_adj_usd: bigint;
  hf_bps: bigint;
}

function valueMicro(asset: PricedAsset): bigint {
  if (!/^\d+$/.test(asset.amount_raw)) throw new Error("amount is not an integer string");
  if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 77) {
    throw new Error("bad decimals");
  }
  const scale = 10n ** BigInt(asset.decimals);
  return (BigInt(asset.amount_raw) * asset.price_micro_usd) / scale;
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function health(collateral: PricedAsset[], borrowed: PricedAsset[]): Health {
  let collateralAdj = 0n;
  let borrowAdj = 0n;
  for (const asset of collateral) {
    collateralAdj += (valueMicro(asset) * BigInt(asset.weight_bps)) / BPS;
  }
  for (const asset of borrowed) {
    if (asset.weight_bps === 0) throw new Error("borrow weight is zero");
    borrowAdj += (valueMicro(asset) * BPS) / BigInt(asset.weight_bps);
  }
  if (borrowAdj === 0n) throw new Error("no debt");
  if (collateralAdj === 0n) throw new Error("no collateral");
  return {
    collateral_adj_usd: collateralAdj,
    borrow_adj_usd: borrowAdj,
    hf_bps: (collateralAdj * BPS) / borrowAdj,
  };
}

/** Micro-USD of debt to repay so health reaches `targetHfBps`. Rounded up. */
export function repayUsdMicro(position: Health, targetHfBps: number, borrowWeightBps: number): bigint {
  const neededBorrow = divCeil(position.collateral_adj_usd * BPS, BigInt(targetHfBps));
  if (position.borrow_adj_usd <= neededBorrow) return 0n;
  return divCeil((position.borrow_adj_usd - neededBorrow) * BigInt(borrowWeightBps), BPS);
}

/** `(1 - HF) / 2` in bps. Zero when HF is at least 1. */
export function liquidationDiscountBps(hfBps: bigint): bigint {
  if (hfBps >= BPS) return 0n;
  return (BPS - hfBps) / 2n;
}

/** Penalty avoided if collateral fell 20% before the rescue. Same assumption as the enclave. */
export function penaltySavedBps(observedHfBps: bigint): bigint {
  return liquidationDiscountBps((observedHfBps * (BPS - STRESS_DROP_BPS)) / BPS);
}
