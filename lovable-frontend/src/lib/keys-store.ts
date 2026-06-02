import { useSyncExternalStore } from "react";
import { fetchKeys, type ApiKey } from "./api";
import { getBuyPrice, getSellPrice, getMarketCap, fmtSol } from "./pricing";

export type Trade = {
  id: string;
  keyId: string;
  wallet: string;
  side: "buy" | "sell" | "create";
  shares: number;
  solAmount: number;    // lamports
  marketcap: number;   // lamports
  txnHash: string;
  ts: number;
};

export type Holder = { wallet: string; shares: number };

export type ThesisPost = {
  id: number;
  wallet: string;
  text: string;
  likes: number;
  likedByMe: boolean;
  updatedAt: number; // ms timestamp
};

export type Key = {
  id: string;        // = name
  name: string;
  symbol: string;    // uppercase name for display
  pfp: string | null;  // URL or null
  creator: string;   // base58 wallet
  createdAt: number; // ms timestamp
  supply: number;
  holders: Holder[];
  trades: Trade[];
  pricePoints: { t: number; price: number }[];
  xUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
  commUrl: string | null;
  thesis: ThesisPost[]; // all posts, newest first
  // 24h volume in lamports — pre-computed by the bulk /api/keys endpoint. The
  // detail endpoint doesn't include it (uses trades[] instead). When undefined,
  // volume24h() falls back to summing trades client-side.
  vol24h?: number;
};

const listeners = new Set<() => void>();
let state: { keys: Key[]; loading: boolean } = { keys: [], loading: false };

const notify = () => listeners.forEach((l) => l());
const setState = (updater: (s: typeof state) => typeof state) => {
  state = updater(state);
  notify();
};

export const useKeysStore = <T,>(selector: (s: typeof state) => T): T =>
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => selector(state),
    () => selector(state),
  );

export const getSnapshot = () => state;

// ─── Pricing helpers (in lamports) ───────────────────────────────────────────

export const priceAt = (supply: number) => getBuyPrice(supply, 1);
export const marketcapAt = (supply: number) => getMarketCap(supply);
export const costToBuy = (supply: number, n: number) => getBuyPrice(supply, n);
export const refundForSell = (supply: number, n: number) => getSellPrice(supply, n);

// ─── Formatting ───────────────────────────────────────────────────────────────

export const truncate = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

export const formatSol = (lamports: number) => fmtSol(lamports);

// ─── Volume ───────────────────────────────────────────────────────────────────

export const volume24h = (k: Key) => {
  // Prefer the backend-computed value (set by the bulk /api/keys list). It's
  // the only path with full trade history per key. The trades[]-based fallback
  // only sees the most-recent 50 trades fetched by the detail endpoint, so on
  // a busy key it would systematically under-report.
  if (typeof k.vol24h === 'number') return k.vol24h;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return k.trades.filter((t) => t.ts >= cutoff).reduce((sum, t) => sum + t.solAmount, 0);
};

// ─── API mapping ──────────────────────────────────────────────────────────────

function apiKeyToKey(k: ApiKey): Key {
  return {
    id: k.name,
    name: k.name,
    symbol: k.name.toUpperCase(),
    pfp: k.pfp_url,
    creator: k.creator_wallet,
    createdAt: new Date(k.created_at).getTime(),
    supply: k.supply,
    holders: [],
    trades: [],
    pricePoints: [],
    xUrl: k.x_url ?? null,
    telegramUrl: k.telegram_url ?? null,
    websiteUrl: k.website_url ?? null,
    commUrl: k.comm_url ?? null,
    thesis: [],
    vol24h: typeof k.vol_24h === 'number' ? k.vol_24h : undefined,
  };
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadKeys(): Promise<void> {
  setState((s) => ({ ...s, loading: true }));
  try {
    const apiKeys = await fetchKeys(100);
    const keys = apiKeys.map(apiKeyToKey);
    setState((s) => ({ ...s, keys, loading: false }));
  } catch {
    setState((s) => ({ ...s, loading: false }));
  }
}

// ─── Update a single key in store (after fetching detail) ─────────────────────

export function updateKeyInStore(updated: Key): void {
  setState((s) => ({
    ...s,
    keys: s.keys.map((k) => (k.id === updated.id ? updated : k)),
  }));
}
