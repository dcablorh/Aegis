import { health, type Health, type PricedAsset } from "./math.js";
import { viewFunction, type ViewOptions } from "./rpc.js";

/** Account position from `get_account`. Balances are decimal strings. */
export interface BurrowAssetBalance {
  token_id: string;
  balance: string;
  shares?: string;
  apr?: string;
}

export interface BurrowAccount {
  account_id: string;
  supplied: BurrowAssetBalance[];
  collateral: BurrowAssetBalance[];
  borrowed: BurrowAssetBalance[];
}

export interface BurrowAssetConfig {
  volatility_ratio: number;
  extra_decimals: number;
  can_use_as_collateral: boolean;
  can_borrow: boolean;
}

/** One entry of `get_assets_paged`: `[token_id, asset]`. */
export interface BurrowAsset {
  token_id: string;
  config: BurrowAssetConfig;
}

export interface BurrowConfig {
  oracle_account_id: string;
}

export interface OraclePrice {
  multiplier: string;
  decimals: number;
}

export interface OraclePriceData {
  timestamp: string;
  recency_duration_sec: number;
  prices: { asset_id: string; price: OraclePrice | null }[];
}

export interface TokenMetadata {
  decimals: number;
  symbol?: string;
}

type RawAsset = { config: BurrowAssetConfig };

export async function getAccount(burrowId: string, accountId: string, options: ViewOptions): Promise<BurrowAccount | null> {
  return viewFunction<BurrowAccount | null>(burrowId, "get_account", { account_id: accountId }, options);
}

export async function getAssetsPaged(burrowId: string, options: ViewOptions): Promise<BurrowAsset[]> {
  const assets: BurrowAsset[] = [];
  const pageSize = 50;
  for (let from = 0; ; from += pageSize) {
    const page = await viewFunction<[string, RawAsset][]>(
      burrowId,
      "get_assets_paged",
      { from_index: from, limit: pageSize },
      options,
    );
    for (const [tokenId, asset] of page) assets.push({ token_id: tokenId, config: asset.config });
    if (page.length < pageSize) return assets;
  }
}

export async function getConfig(burrowId: string, options: ViewOptions): Promise<BurrowConfig> {
  return viewFunction<BurrowConfig>(burrowId, "get_config", {}, options);
}

export async function getOraclePrices(oracleId: string, options: ViewOptions): Promise<OraclePriceData> {
  return viewFunction<OraclePriceData>(oracleId, "get_price_data", {}, options);
}

export async function getTokenMetadata(tokenId: string, options: ViewOptions): Promise<TokenMetadata> {
  return viewFunction<TokenMetadata>(tokenId, "ft_metadata", {}, options);
}

/** Burrow price `{multiplier, decimals}` to micro-USD per whole token. */
export function priceToMicroUsd(price: OraclePrice): bigint {
  const multiplier = BigInt(price.multiplier);
  const scale = 10n ** BigInt(price.decimals);
  return (multiplier * 1_000_000n) / scale;
}

export interface LiveHealth {
  health: Health;
  collateral: PricedAsset[];
  borrowed: PricedAsset[];
}

/**
 * Health of a Burrow account. Collateral is the collateral list only (supplied-but-not-collateral
 * does not count). Throws if a used token has no oracle price. Testnet currently returns null prices.
 */
export async function readHealth(burrowId: string, accountId: string, options: ViewOptions): Promise<LiveHealth | null> {
  const account = await getAccount(burrowId, accountId, options);
  if (!account) return null;
  const [assets, config] = await Promise.all([getAssetsPaged(burrowId, options), getConfig(burrowId, options)]);
  const prices = await getOraclePrices(config.oracle_account_id, options);
  const priceByToken = new Map(prices.prices.map((entry) => [entry.asset_id, entry.price]));
  const configByToken = new Map(assets.map((asset) => [asset.token_id, asset.config]));
  const used = [...account.collateral, ...account.borrowed].map((leg) => leg.token_id);
  const decimals = new Map<string, number>();
  for (const tokenId of new Set(used)) {
    const meta = await getTokenMetadata(tokenId, options);
    const extra = configByToken.get(tokenId)?.extra_decimals ?? 0;
    decimals.set(tokenId, meta.decimals + extra);
  }
  const toPriced = (leg: BurrowAssetBalance): PricedAsset => {
    const price = priceByToken.get(leg.token_id);
    if (!price) throw new Error(`missing oracle price for ${leg.token_id}`);
    const assetConfig = configByToken.get(leg.token_id);
    if (!assetConfig) throw new Error(`missing Burrow config for ${leg.token_id}`);
    const tokenDecimals = decimals.get(leg.token_id);
    if (tokenDecimals === undefined) throw new Error(`missing metadata for ${leg.token_id}`);
    return {
      amount_raw: leg.balance,
      decimals: tokenDecimals,
      weight_bps: assetConfig.volatility_ratio,
      price_micro_usd: priceToMicroUsd(price),
    };
  };
  const collateral = account.collateral.map(toPriced);
  const borrowed = account.borrowed.map(toPriced);
  return { health: health(collateral, borrowed), collateral, borrowed };
}
