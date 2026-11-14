import { useSyncExternalStore } from "react";

export type Network = "testnet" | "mainnet";

export interface ReadRecord {
  id: string;
  at: string;
  network: Network;
  accountId: string;
  healthLabel: string;
  collateralCount: number;
  debtCount: number;
  priceNote: string | null;
}

export interface DraftRecord {
  id: string;
  at: string;
  accountId: string;
  minimum: string;
  target: string;
  slippage: string;
  commitment: string;
  ciphertext: string;
  salt: string;
}

export interface QuoteRecord {
  id: string;
  at: string;
  amount: string;
  penalty: number;
  dry: boolean;
  depositAddress: string;
  amountIn: string;
  minAmountIn: string;
  amountOut: string;
  expectedBps: number;
  worstBps: number;
}

interface Store {
  network: Network;
  reads: ReadRecord[];
  drafts: DraftRecord[];
  quotes: QuoteRecord[];
}

const KEY = "aegis-session-v1";
const EMPTY: Store = { network: "testnet", reads: [], drafts: [], quotes: [] };

function readStore(): Store {
  if (typeof sessionStorage === "undefined") return EMPTY;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (!parsed || !Array.isArray(parsed.reads) || !Array.isArray(parsed.drafts) || !Array.isArray(parsed.quotes)) return EMPTY;
    return {
      network: parsed.network === "mainnet" ? "mainnet" : "testnet",
      reads: parsed.reads,
      drafts: parsed.drafts,
      quotes: parsed.quotes,
    };
  } catch {
    return EMPTY;
  }
}

let store = readStore();
const listeners = new Set<() => void>();

function commit(next: Store) {
  store = next;
  sessionStorage.setItem(KEY, JSON.stringify(store));
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): Store {
  return useSyncExternalStore(subscribe, () => store, () => EMPTY);
}

export function setNetwork(network: Network) {
  commit({ ...store, network });
}

export function rememberRead(record: ReadRecord) {
  const reads = [record, ...store.reads.filter((item) => item.accountId !== record.accountId || item.network !== record.network)].slice(0, 20);
  commit({ ...store, reads });
}

export function rememberDraft(record: DraftRecord) {
  commit({ ...store, drafts: [record, ...store.drafts].slice(0, 20) });
}

export function rememberQuote(record: QuoteRecord) {
  commit({ ...store, quotes: [record, ...store.quotes.filter((item) => item.id !== record.id)].slice(0, 20) });
}

export function findDraft(id: string): DraftRecord | undefined {
  return store.drafts.find((item) => item.id === id);
}

export function findQuote(id: string): QuoteRecord | undefined {
  return store.quotes.find((item) => item.id === id);
}
