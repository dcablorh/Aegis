import {
  BURROW_MAINNET,
  BURROW_TESTNET,
  RPC_MAINNET,
  RPC_TESTNET,
  getAccount,
  getAssetsPaged,
  getConfig,
  getOraclePrices,
  getTokenMetadata,
  health,
  liquidationDiscountBps,
  priceToMicroUsd,
  viewFunction,
  type BurrowAccount,
  type OraclePrice,
} from "@aegis/rhea-client";
import { formatHf, formatUnits } from "../format";
import type { Network } from "./session";
import { VAULT_TESTNET } from "../config";

export interface Row {
  tokenId: string;
  role: "Collateral" | "Debt";
  amount: string;
  price: string;
  weight: string;
}

export interface PositionResult {
  account: BurrowAccount;
  rows: Row[];
  healthLabel: string;
  discountLabel: string;
  priceNote: string | null;
  collateralUsd: bigint | null;
  debtUsd: bigint | null;
}

export async function loadPosition(network: Network, accountId: string): Promise<PositionResult> {
  const rpcUrl = network === "testnet" ? RPC_TESTNET : RPC_MAINNET;
  const burrowId = network === "testnet" ? BURROW_TESTNET : BURROW_MAINNET;
  const options = { rpcUrl };

  let targetId = accountId.trim();
  let [account, assets, config] = await Promise.all([
    getAccount(burrowId, targetId, options),
    getAssetsPaged(burrowId, options),
    getConfig(burrowId, options),
  ]);

  // If Burrow returns no account and we are on testnet, check if accountId is a registered borrower whose position sub-account is mapped on the vault
  if (!account && network === "testnet") {
    try {
      const mapped = await viewFunction<string | null>(
        VAULT_TESTNET,
        "get_position",
        { account_id: targetId },
        options
      );
      if (mapped) {
        targetId = mapped;
        account = await getAccount(burrowId, targetId, options);
      }
    } catch {
      // fallback
    }
  }

  if (!account) {
    throw new Error(
      `Burrow has no account for "${accountId}". On testnet, try the deployed position sub-account: position1.aegis-cloud-319903.testnet`
    );
  }
  const prices = await getOraclePrices(config.oracle_account_id, options);
  const priceById = new Map(prices.prices.map((entry) => [entry.asset_id, entry.price]));
  const configById = new Map(assets.map((asset) => [asset.token_id, asset.config]));
  const ids = [...new Set([...account.collateral, ...account.borrowed].map((leg) => leg.token_id))];
  const metaEntries = await Promise.all(ids.map(async (id) => [id, await getTokenMetadata(id, options)] as const));
  const decimalsById = new Map(metaEntries.map(([id, meta]) => [id, meta.decimals + (configById.get(id)?.extra_decimals ?? 0)]));

  const missing: string[] = [];
  const rows: Row[] = [];
  const collateral = [];
  const borrowed = [];
  let collateralUsd = 0n;
  let debtUsd = 0n;
  for (const leg of account.collateral) {
    const built = describe(leg.token_id, "Collateral", leg.balance, priceById.get(leg.token_id) ?? null, configById, decimalsById, missing);
    rows.push(built.row);
    if (built.priced) {
      collateral.push(built.priced);
      collateralUsd += legUsd(built.priced);
    }
  }
  for (const leg of account.borrowed) {
    const built = describe(leg.token_id, "Debt", leg.balance, priceById.get(leg.token_id) ?? null, configById, decimalsById, missing);
    rows.push(built.row);
    if (built.priced) {
      borrowed.push(built.priced);
      debtUsd += legUsd(built.priced);
    }
  }

  let healthLabel = "Not calculated";
  let discountLabel = "Not calculated";
  let priceNote: string | null = null;
  if (missing.length > 0) {
    priceNote = `No oracle price for ${missing.join(", ")}. Health factor is withheld.`;
  } else if (borrowed.length === 0) {
    priceNote = "This account has no debt, so a health factor is not defined.";
  } else if (collateral.length === 0) {
    priceNote = "This account has debt and no collateral.";
  } else {
    const position = health(collateral, borrowed);
    healthLabel = formatHf(position.hf_bps);
    const discount = liquidationDiscountBps(position.hf_bps);
    discountLabel = discount === 0n ? "0 bps while health is at least 1.00" : `${discount.toString()} bps`;
  }
  const priced = missing.length === 0;
  return {
    account,
    rows,
    healthLabel,
    discountLabel,
    priceNote,
    collateralUsd: priced ? collateralUsd : null,
    debtUsd: priced ? debtUsd : null,
  };
}

export function money(micro: bigint): string {
  return `$${formatUnits(micro.toString(), 6, 2)}`;
}

export function readHf(label: string): number | null {
  return /^\d+\.\d{2}$/.test(label) ? Number(label) : null;
}

function legUsd(priced: { amount_raw: string; decimals: number; price_micro_usd: bigint }): bigint {
  return (BigInt(priced.amount_raw) * priced.price_micro_usd) / (10n ** BigInt(priced.decimals));
}

function describe(
  tokenId: string,
  role: Row["role"],
  balance: string,
  price: OraclePrice | null,
  configById: Map<string, { volatility_ratio: number; extra_decimals: number }>,
  decimalsById: Map<string, number>,
  missing: string[],
) {
  const decimals = decimalsById.get(tokenId) ?? 0;
  const weight = configById.get(tokenId)?.volatility_ratio;
  const row: Row = {
    tokenId,
    role,
    amount: formatUnits(balance, decimals),
    price: price ? `$${formatUnits(priceToMicroUsd(price).toString(), 6, 4)}` : "Unavailable",
    weight: weight === undefined ? "Unknown" : `${weight} bps`,
  };
  if (!price || weight === undefined) {
    missing.push(tokenId);
    return { row, priced: null };
  }
  return {
    row,
    priced: { amount_raw: balance, decimals, weight_bps: weight, price_micro_usd: priceToMicroUsd(price) },
  };
}
