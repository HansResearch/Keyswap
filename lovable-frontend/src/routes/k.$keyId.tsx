import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  fetchConfig,
  fetchHolderBalance,
  fetchSubjectStateByName,
  getSubjectNamePda,
  getMintPda,
  prepareBuySharesTransaction,
  prepareSellSharesTransaction,
  prefetchTradeContext,
  signAndSendPrepared,
  type Holder,
  type PreparedTransaction,
} from "@/lib/program";
import {
  useKeysStore, formatSol, marketcapAt, priceAt, costToBuy, refundForSell,
  truncate, updateKeyInStore, type Key, type Trade, type ThesisPost,
} from "@/lib/keys-store";
import { fetchKeyDetail, updateKeySocials, submitThesis, likeThesis, fetchHoldersFromApi, type ApiTrade, type ApiThesis } from "@/lib/api";
import { toast } from "sonner";
import { getBuyPrice, getSellSlippage, fmtUsd } from "@/lib/pricing";
import { useSolPrice } from "@/lib/use-sol-price";
import { KeyAvatar } from "@/components/KeyAvatar";
import { PriceChart } from "@/components/PriceChart";

export const Route = createFileRoute("/k/$keyId")({
  component: KeyPage,
  notFoundComponent: () => (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Link to="/" className="text-mono-xs text-primary hover:underline">← Key not found</Link>
    </div>
  ),
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <p className="text-mono-xs text-destructive">{error.message}</p>
        <button onClick={() => { router.invalidate(); reset(); }} className="text-mono-xs text-primary">Retry</button>
      </div>
    );
  },
});

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function apiTradeToTrade(t: ApiTrade, keyId: string): Trade {
  return {
    id: String(t.id),
    keyId,
    wallet: t.trader,
    side: t.trade_type === 'BUY' ? 'buy' : t.trade_type === 'SELL' ? 'sell' : 'create',
    shares: t.amount,
    solAmount: t.price_sol,
    marketcap: 0,
    txnHash: t.tx_sig,
    ts: t.block_time ? new Date(t.block_time).getTime() : Date.now(),
  };
}

function buildPricePoints(trades: ApiTrade[]): { t: number; price: number }[] {
  // Walk through trades in chronological order, reconstructing supply
  const sorted = [...trades].sort((a, b) => {
    const ta = a.block_time ? new Date(a.block_time).getTime() : 0;
    const tb = b.block_time ? new Date(b.block_time).getTime() : 0;
    return ta - tb;
  });
  let supply = 0;
  const points: { t: number; price: number }[] = [];
  for (const t of sorted) {
    if (t.trade_type === 'BUY' || t.trade_type === 'CREATE') supply += t.amount;
    else if (t.trade_type === 'SELL') supply = Math.max(0, supply - t.amount);
    const ts = t.block_time ? new Date(t.block_time).getTime() : Date.now();
    points.push({ t: ts, price: getBuyPrice(supply, 1) });
  }
  return points;
}

function KeyPage() {
  const { keyId } = Route.useParams();
  const storeKey = useKeysStore((s) => s.keys.find((k) => k.id === keyId));
  const [localKey, setLocalKey] = useState<Key | null>(null);
  const [fetching, setFetching] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<"transactions" | "holders">("transactions");
  const { publicKey } = useWallet();

  const key = localKey ?? storeKey ?? null;

  const refreshKey = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setFetching(true);
      setNotFound(false);
    }

    const viewer = publicKey?.toBase58();
    const data = await fetchKeyDetail(keyId, viewer);
    if (!data) {
      if (showLoading) {
        setNotFound(true);
        setFetching(false);
      }
      return null;
    }

      const trades = data.trades.map((t) => apiTradeToTrade(t, keyId));
      const pricePoints = buildPricePoints(data.trades);
      const updated: Key = {
        id: data.key.name,
        name: data.key.name,
        symbol: data.key.name.toUpperCase(),
        pfp: data.key.pfp_url,
        creator: data.key.creator_wallet,
        createdAt: new Date(data.key.created_at).getTime(),
        supply: data.key.supply,
        holders: [],
        trades,
        pricePoints,
        xUrl: data.key.x_url ?? null,
        telegramUrl: data.key.telegram_url ?? null,
        websiteUrl: data.key.website_url ?? null,
        commUrl: data.key.comm_url ?? null,
        thesis: (data.thesis ?? []).map((t: ApiThesis): ThesisPost => ({
          id: t.id,
          wallet: t.wallet,
          text: t.thesis,
          likes: t.likes ?? 0,
          likedByMe: Boolean(t.liked_by_me),
          updatedAt: t.updated_at ? new Date(t.updated_at).getTime() : Date.now(),
        })),
      };
      setLocalKey(updated);
      updateKeyInStore(updated);
      setFetching(false);
      return updated;
  }, [keyId, publicKey]);

  useEffect(() => {
    refreshKey({ showLoading: true });
  }, [refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshKey();
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [refreshKey]);

  const solPrice = useSolPrice();

  if (fetching && !key) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="text-mono-xs text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (notFound || !key) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Link to="/" className="text-mono-xs text-primary hover:underline">← Key not found</Link>
      </div>
    );
  }
  const mc = marketcapAt(key.supply);
  const price = priceAt(key.supply);
  const firstPrice = key.pricePoints[0]?.price ?? price;
  const change = firstPrice > 0 ? ((price - firstPrice) / firstPrice) * 100 : 0;
  const up = change >= 0;

  const streamAfterTrade = () => {
    refreshKey();
    const started = Date.now();
    const timer = window.setInterval(() => {
      refreshKey();
      if (Date.now() - started > 12_000) window.clearInterval(timer);
    }, 1_000);
  };

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <KeyAvatar pfp={key.pfp} name={key.name} size={48} />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold sm:text-xl">{key.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-mono-xs text-muted-foreground">
                <span>{key.symbol}</span>
                <span className="text-border">·</span>
                <span>by {truncate(key.creator)}</span>
                <span className="text-border">·</span>
                <a
                  href={`https://solscan.io/token/${getMintPda(getSubjectNamePda(keyId)).toBase58()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  title="View this key's SPL token on Solscan"
                >
                  Solscan ↗
                </a>
              </div>
              <SocialLinks xUrl={key.xUrl} telegramUrl={key.telegramUrl} websiteUrl={key.websiteUrl} commUrl={key.commUrl} />
            </div>
          </div>
          {/* Stats: 2-up grid on mobile (4 stats stack 2x2), inline row on desktop */}
          <div className="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:gap-8">
            <Stat
              label="Price"
              value={solPrice > 0 ? fmtUsd(price, solPrice) : `${formatSol(price)} SOL`}
              sub={solPrice > 0 ? `${formatSol(price)} SOL` : undefined}
            />
            <Stat
              label="Marketcap"
              value={solPrice > 0 ? fmtUsd(mc, solPrice) : `${formatSol(mc)} SOL`}
              sub={solPrice > 0 ? `${formatSol(mc)} SOL` : undefined}
            />
            <Stat label="Change" value={`${up ? "+" : ""}${change.toFixed(2)}%`} accent={up ? "success" : "destructive"} />
            <Stat label="Supply" value={key.supply.toString()} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Left: chart + table */}
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-mono-xs text-muted-foreground">Price History</span>
                <span className={`text-mono-xs ${up ? "text-success" : "text-destructive"}`}>{up ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%</span>
              </div>
              <PriceChart points={key.pricePoints} height={220} id={key.id} />
            </div>

            <div>
              <div className="mb-3 flex items-center gap-1 border-b border-border">
                <TabBtn active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</TabBtn>
                <TabBtn active={tab === "holders"} onClick={() => setTab("holders")}>Holders</TabBtn>
              </div>

              {tab === "transactions" ? (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
                        <th className="hidden px-4 py-2.5 text-left font-normal sm:table-cell">Wallet</th>
                        <th className="px-3 py-2.5 text-left font-normal sm:px-4">Side</th>
                        <th className="px-3 py-2.5 text-right font-normal sm:px-4">SOL</th>
                        <th className="px-3 py-2.5 text-right font-normal sm:px-4">Keys</th>
                        <th className="px-3 py-2.5 text-right font-normal sm:px-4">Age</th>
                        <th className="hidden px-4 py-2.5 text-right font-normal sm:table-cell">Txn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {key.trades.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-mono-xs text-muted-foreground">No transactions yet</td></tr>
                      ) : key.trades.map((t) => (
                        <tr key={t.id} className="border-b border-border/50 hover:bg-surface">
                          <td className="hidden px-4 py-2.5 text-mono-xs sm:table-cell">{truncate(t.wallet)}</td>
                          <td className="px-3 py-2.5 sm:px-4">
                            <span className={`text-mono-xs font-semibold ${t.side === "buy" || t.side === "create" ? "text-success" : "text-destructive"}`}>
                              {t.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums sm:px-4">{formatSol(t.solAmount)} SOL</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums sm:px-4">{t.shares}</td>
                          <td className="px-3 py-2.5 text-right text-mono-xs text-muted-foreground tabular-nums sm:px-4">{timeAgo(t.ts)}</td>
                          <td className="hidden px-4 py-2.5 text-right sm:table-cell">
                            <a href={`https://solscan.io/tx/${t.txnHash}`} target="_blank" rel="noreferrer" className="text-mono-xs text-primary hover:underline">
                              {t.txnHash.slice(0, 6)}↗
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <HoldersTab keyId={keyId} supply={key.supply} thesis={key.thesis} viewerWallet={publicKey?.toBase58() ?? null} />
              )}
            </div>
          </div>

          {/* Right: trade panel + thesis feed + creator edit */}
          <div className="space-y-4">
            <TradePanel
              keyId={key.id}
              supply={key.supply}
              creatorWallet={key.creator}
              onTraded={streamAfterTrade}
            />
            <ThesisFeed
              keyId={key.id}
              thesis={key.thesis}
              viewerWallet={publicKey?.toBase58() ?? null}
            />
            <CreatorPanel
              keyId={key.id}
              creatorWallet={key.creator}
              xUrl={key.xUrl}
              telegramUrl={key.telegramUrl}
              websiteUrl={key.websiteUrl}
              commUrl={key.commUrl}
              onSaved={refreshKey}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function HoldersTab({
  keyId, supply, thesis, viewerWallet,
}: {
  keyId: string;
  supply: number;
  thesis: ThesisPost[];
  viewerWallet: string | null;
}) {
  const [holders, setHolders] = useState<Holder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const [likeState, setLikeState] = useState<Record<string, { likes: number; likedByMe: boolean }>>({});
  const recentLike = useRef<Record<string, number>>({});

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchHoldersFromApi(keyId).then((rows) => {
      if (!mountedRef.current) return;
      setHolders(rows.map(r => ({ wallet: r.wallet, balance: r.balance })));
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [keyId, supply]);

  // Latest post per wallet (for holders tab display)
  const latestByWallet = thesis.reduce<Record<string, ThesisPost>>((acc, p) => {
    if (!acc[p.wallet] || p.updatedAt > acc[p.wallet].updatedAt) acc[p.wallet] = p;
    return acc;
  }, {});

  useEffect(() => {
    const now = Date.now();
    setLikeState((prev) => {
      const next = { ...prev };
      for (const post of thesis) {
        const lastTs = recentLike.current[post.wallet] ?? 0;
        if (now - lastTs > 5000) {
          next[post.wallet] = { likes: post.likes, likedByMe: post.likedByMe };
        }
      }
      return next;
    });
  }, [thesis]);

  const handleLike = async (thesisWallet: string) => {
    if (!viewerWallet) return;
    recentLike.current[thesisWallet] = Date.now();
    const entry = latestByWallet[thesisWallet];
    const current = likeState[thesisWallet] ?? { likes: entry?.likes ?? 0, likedByMe: entry?.likedByMe ?? false };
    setLikeState((prev) => ({
      ...prev,
      [thesisWallet]: { likes: current.likedByMe ? current.likes - 1 : current.likes + 1, likedByMe: !current.likedByMe },
    }));
    const result = await likeThesis(keyId, thesisWallet, viewerWallet);
    if (result) {
      recentLike.current[thesisWallet] = 0;
      setLikeState((prev) => ({ ...prev, [thesisWallet]: { likes: result.likes, likedByMe: result.liked } }));
    }
  };

  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="px-4 py-8 text-center text-mono-xs text-muted-foreground">Loading holders…</div>
      </div>
    );
  }

  if (!holders || holders.length === 0) {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="px-4 py-8 text-center text-mono-xs text-muted-foreground">No holders found</div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
            <th className="hidden px-4 py-2.5 text-left font-normal sm:table-cell">#</th>
            <th className="px-3 py-2.5 text-left font-normal sm:px-4">Wallet</th>
            <th className="hidden px-4 py-2.5 text-left font-normal md:table-cell">Thesis</th>
            <th className="px-3 py-2.5 text-right font-normal sm:px-4">Keys</th>
            <th className="hidden px-4 py-2.5 text-right font-normal sm:table-cell">% Supply</th>
          </tr>
        </thead>
        <tbody>
          {holders.map((h, i) => {
            const entry = latestByWallet[h.wallet];
            const ls = likeState[h.wallet] ?? { likes: entry?.likes ?? 0, likedByMe: entry?.likedByMe ?? false };
            const isOwn = viewerWallet === h.wallet;
            const canLike = !!viewerWallet && !isOwn && !!entry;
            return (
              <tr key={h.wallet} className="border-b border-border/50 hover:bg-surface">
                <td className="hidden px-4 py-2.5 text-mono-xs text-muted-foreground sm:table-cell">{i + 1}</td>
                <td className="px-3 py-2.5 text-mono-xs sm:px-4">{truncate(h.wallet)}</td>
                <td className="hidden px-4 py-2.5 md:table-cell">
                  {entry ? (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm leading-snug text-foreground">{entry.text}</span>
                      <button
                        onClick={() => canLike && handleLike(h.wallet)}
                        title={!viewerWallet ? "Connect wallet to like" : isOwn ? "Can't like your own thesis" : ls.likedByMe ? "Unlike" : "Like"}
                        className={`flex shrink-0 items-center gap-1 transition-colors ${
                          ls.likedByMe ? "text-foreground" : canLike ? "cursor-pointer text-muted-foreground/50 hover:text-foreground" : "cursor-default text-muted-foreground/25"
                        }`}
                      >
                        <Heart filled={ls.likedByMe} size={15} />
                        <span className="tabular-nums text-mono-xs font-medium">{ls.likes}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/30 text-mono-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums sm:px-4">{h.balance}</td>
                <td className="hidden px-4 py-2.5 text-right text-mono-xs tabular-nums sm:table-cell">
                  {supply > 0 ? ((h.balance / supply) * 100).toFixed(1) : "0.0"}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "success" | "destructive" }) {
  return (
    <div>
      <div className="text-mono-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-mono-xs text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`relative cursor-pointer px-4 py-2.5 text-mono-xs font-semibold transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {children}
      {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
    </button>
  );
}

function TradePanel({
  keyId,
  supply,
  creatorWallet,
  onTraded,
}: {
  keyId: string;
  supply: number;
  creatorWallet: string;
  onTraded: () => void;
}) {
  const { publicKey, wallet, connected, signTransaction, sendTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [showThesis, setShowThesis] = useState(false);
  const [thesis, setThesis] = useState("");
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisSaved, setThesisSaved] = useState(false);
  const [royaltyWallet, setRoyaltyWallet] = useState<string | null>(null);
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null);
  const [preparingTx, setPreparingTx] = useState(false);

  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const maxSell = held ?? 0;
  // The on-chain contract requires `supply > amount` — so the very last share is
  // locked (otherwise supply would hit 0 and the key would die). Effective max
  // sellable = min(your holdings, supply - 1). If you're the sole holder, you
  // can never sell your last key until someone else buys in.
  const sellable = Math.max(0, Math.min(maxSell, supply - 1));
  const quoteAmount = side === "sell" ? Math.min(n, sellable) : n;
  const cost = side === "buy" ? costToBuy(supply, n) : refundForSell(supply, quoteAmount);
  const nextPrice = priceAt(side === "buy" ? supply + n : Math.max(supply - n, 0));
  const slippage = side === "sell" && quoteAmount > 0 ? getSellSlippage(supply, quoteAmount) : 0;
  const sellAmountTooHigh = side === "sell" && n > sellable;
  const sellDisabled = side === "sell" && (held === null || sellable <= 0 || sellAmountTooHigh);

  useEffect(() => {
    let cancelled = false;

    async function loadHeld() {
      if (!connected || !publicKey) {
        setHeld(null);
        return;
      }

      const balance = await fetchHolderBalance(connection, getSubjectNamePda(keyId), publicKey);
      if (!cancelled) setHeld(balance);
    }

    loadHeld();
    return () => { cancelled = true; };
  }, [connected, connection, keyId, publicKey, supply]);

  useEffect(() => {
    let cancelled = false;

    async function warmTradeContext() {
      prefetchTradeContext(connection, keyId);
      const state = await fetchSubjectStateByName(connection, keyId);
      if (cancelled) return;
      setRoyaltyWallet(state && state.royaltyPercent > 0 ? state.royaltyWallet.toBase58() : creatorWallet);
    }

    warmTradeContext();
    const timer = window.setInterval(() => {
      warmTradeContext();
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection, creatorWallet, keyId, supply]);

  useEffect(() => {
    let cancelled = false;

    async function prepareTx() {
      // Bail early — clear BOTH flags so we never get stuck showing "Preparing…"
      // when the form isn't ready (amount=0, no balance, no wallet, etc.).
      const shouldPrepare =
        connected &&
        publicKey &&
        royaltyWallet &&
        n > 0 &&
        !(side === "sell" && (held === null || sellable <= 0 || n > sellable));
      if (!shouldPrepare) {
        setPreparedTx(null);
        setPreparingTx(false);
        return;
      }

      setPreparedTx(null);
      setPreparingTx(true);
      try {
        const config = await fetchConfig(connection);
        if (!config || cancelled) return;
        const creatorPubkey = new PublicKey(creatorWallet);
        const resolvedRoyaltyWallet = new PublicKey(royaltyWallet);
        const prepared = side === "buy"
          ? await prepareBuySharesTransaction(
              connection,
              publicKey,
              keyId,
              n,
              supply,
              creatorPubkey,
              config.feeDestination,
              resolvedRoyaltyWallet,
            )
          : await prepareSellSharesTransaction(
              connection,
              publicKey,
              keyId,
              n,
              creatorPubkey,
              config.feeDestination,
              resolvedRoyaltyWallet,
            );
        if (!cancelled) setPreparedTx(prepared);
      } catch {
        if (!cancelled) setPreparedTx(null);
      } finally {
        if (!cancelled) setPreparingTx(false);
      }
    }

    prepareTx();
    const timer = window.setInterval(prepareTx, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connected, connection, creatorWallet, held, keyId, maxSell, n, publicKey, royaltyWallet, side, supply]);

  const execute = async () => {
    if (!connected || !publicKey || !wallet) {
      setError("Connect your wallet first");
      return;
    }
    if (n <= 0) return;
    if (side === "sell" && held === null) {
      setError("Still loading your key balance");
      return;
    }
    if (side === "sell" && maxSell <= 0) {
      setError("You do not have any keys to sell");
      return;
    }
    if (side === "sell" && sellable <= 0) {
      setError("Last share is locked — wait for another buyer first, then you can sell");
      return;
    }
    if (side === "sell" && n > sellable) {
      setError(n > maxSell
        ? `You only hold ${maxSell} key${maxSell === 1 ? "" : "s"}`
        : `Max sellable is ${sellable} — the last share must stay (keeps the market alive)`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const wallet = { publicKey: publicKey!, signTransaction: signTransaction!, sendTransaction };

      // Fast path: use the pre-prepared tx if it's ready. Slow path: prepare now.
      // The slow path covers the case where pre-prepare failed (RPC rate-limited,
      // network glitch) — without it the user would be stuck on "Preparing…" forever.
      let txToSend = preparedTx;
      if (!txToSend) {
        const config = await fetchConfig(connection);
        if (!config) throw new Error("Could not reach Solana — please check your connection and try again");
        const creatorPubkey = new PublicKey(creatorWallet);
        const resolvedRoyaltyWallet = new PublicKey(royaltyWallet ?? creatorWallet);
        txToSend = side === "buy"
          ? await prepareBuySharesTransaction(
              connection,
              publicKey,
              keyId,
              n,
              supply,
              creatorPubkey,
              config.feeDestination,
              resolvedRoyaltyWallet,
            )
          : await prepareSellSharesTransaction(
              connection,
              publicKey,
              keyId,
              n,
              creatorPubkey,
              config.feeDestination,
              resolvedRoyaltyWallet,
            );
      }
      await signAndSendPrepared(connection, wallet, txToSend);

      // Success toast — show the same info the user sees in the modal
      toast.success(
        side === "buy"
          ? `Bought ${n} key${n === 1 ? "" : "s"} of ${keyId}`
          : `Sold ${n} key${n === 1 ? "" : "s"} of ${keyId}`
      );

      setAmount("1");
      onTraded();
      const balance = await fetchHolderBalance(connection, getSubjectNamePda(keyId), publicKey);
      setHeld(balance);
      if (side === "buy") { setShowThesis(true); setThesis(""); setThesisSaved(false); }
    } catch (e: any) {
      const msg = e?.message ?? "Transaction failed";
      setError(msg);
      toast.error(`${side === "buy" ? "Buy" : "Sell"} failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Sticky only on lg+ (where the trade panel sits in its own right column).
    // On mobile/tablet the column stacks below the chart, so sticky would
    // overlap the viewport awkwardly as the user scrolls.
    <div className="h-fit rounded-lg border border-border bg-surface p-4 shadow-lg lg:sticky lg:top-20">
      {!connected ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-mono-xs text-muted-foreground">Connect your wallet to trade</p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
            <button onClick={() => { setSide("buy"); setError(null); }} className={`cursor-pointer rounded py-2 text-mono-xs font-bold transition ${side === "buy" ? "bg-success/20 text-success" : "text-muted-foreground hover:text-foreground"}`}>BUY</button>
            <button onClick={() => { setSide("sell"); setError(null); }} className={`cursor-pointer rounded py-2 text-mono-xs font-bold transition ${side === "sell" ? "bg-destructive/20 text-destructive" : "text-muted-foreground hover:text-foreground"}`}>SELL</button>
          </div>

          <label className="text-mono-xs text-muted-foreground">Amount of keys</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm tabular-nums outline-none focus:border-primary"
          />
          <div className="mt-1 flex gap-1">
            {[1, 5, 10, 25].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v.toString())}
                disabled={side === "sell" && v > sellable}
                className="flex-1 cursor-pointer rounded border border-border bg-background py-1 text-mono-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                {v}
              </button>
            ))}
            {side === "sell" && (
              <button
                onClick={() => setAmount(sellable.toString())}
                disabled={sellable <= 0}
                title={sellable <= 0
                  ? "Last share is locked"
                  : `Sell your max (${sellable})`}
                className="flex-1 cursor-pointer rounded border border-primary bg-background py-1 text-mono-xs font-bold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:opacity-30"
              >
                MAX
              </button>
            )}
          </div>

          <div className="mt-4 space-y-2 rounded-md border border-border bg-background p-3 text-mono-xs">
            <Row label={side === "buy" ? "You pay" : "You receive"} value={`${formatSol(cost)} SOL`} />
            <Row label="Avg price" value={quoteAmount > 0 ? `${formatSol(Math.floor(cost / quoteAmount))} SOL` : "—"} />
            <Row label="Next price" value={`${formatSol(nextPrice)} SOL`} />
            {side === "sell" && (
              <>
                <Row label="You hold" value={held === null ? "Loading" : held.toString()} />
                {held !== null && held > sellable && (
                  <Row label="Max sellable" value={`${sellable} (last share locked)`} />
                )}
                {quoteAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Slippage</span>
                    <span className={`tabular-nums font-semibold ${slippage < 10 ? "text-success" : slippage < 25 ? "text-muted-foreground" : "text-destructive"}`}>
                      {slippage.toFixed(1)}%
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {sellAmountTooHigh && (
            <p className="mt-2 text-mono-xs text-destructive">
              {n > maxSell
                ? `You only hold ${maxSell} key${maxSell === 1 ? "" : "s"}`
                : `Max sellable is ${sellable} — the last share is locked to keep the market alive`}
            </p>
          )}

          {error && (
            <p className="mt-2 text-mono-xs text-destructive">{error}</p>
          )}

          <button
            onClick={execute}
            disabled={n <= 0 || sellDisabled || busy}
            className={`mt-4 w-full cursor-pointer rounded-md py-2.5 text-mono-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${side === "buy" ? "bg-success text-background hover:opacity-90" : "bg-destructive text-destructive-foreground hover:opacity-90"}`}
          >
            {busy
              ? "Confirming…"
              : preparingTx
                ? "Preparing…"
                : side === "buy"
                  ? "Buy keys"
                  : `Sell ${Math.min(n || 0, sellable)} key${Math.min(n || 0, sellable) === 1 ? "" : "s"}`}
          </button>

          {showThesis && (
            <div className="mt-4 rounded-md border border-border bg-background p-3">
              {thesisSaved ? (
                <p className="text-center text-sm text-success">Thesis saved ✓</p>
              ) : (
                <>
                  <label className="text-mono-xs text-muted-foreground">Your thesis <span className="text-muted-foreground/50">(up to 280 chars)</span></label>
                  <textarea
                    value={thesis}
                    onChange={e => setThesis(e.target.value.slice(0, 280))}
                    placeholder="Why are you buying this key?"
                    rows={3}
                    className="mt-1.5 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-mono-xs text-muted-foreground/50">
                      {thesis.length}/280
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setShowThesis(false)} className="cursor-pointer text-mono-xs text-muted-foreground hover:text-foreground">Skip</button>
                      <button
                        disabled={thesis.trim().length < 2 || thesisSaving}
                        onClick={async () => {
                          if (!publicKey) return;
                          setThesisSaving(true);
                          const ok = await submitThesis(keyId, publicKey.toBase58(), thesis.trim());
                          setThesisSaving(false);
                          if (ok) { setThesisSaved(true); onTraded(); }
                        }}
                        className="cursor-pointer rounded bg-primary px-3 py-1 text-mono-xs font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {thesisSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ThesisFeed({
  keyId,
  thesis,
  viewerWallet,
}: {
  keyId: string;
  thesis: ThesisPost[];
  viewerWallet: string | null;
}) {
  // Like state keyed by wallet (likes are per-holder, shown on all their posts)
  const [likeState, setLikeState] = useState<Record<string, { likes: number; likedByMe: boolean }>>({});
  const recentLike = useRef<Record<string, number>>({});

  useEffect(() => {
    const now = Date.now();
    setLikeState((prev) => {
      const next = { ...prev };
      for (const post of thesis) {
        const lastTs = recentLike.current[post.wallet] ?? 0;
        if (now - lastTs > 5000) {
          next[post.wallet] = { likes: post.likes, likedByMe: post.likedByMe };
        }
      }
      return next;
    });
  }, [thesis]);

  const handleLike = async (thesisWallet: string) => {
    if (!viewerWallet) return;
    recentLike.current[thesisWallet] = Date.now();
    const post = thesis.find(p => p.wallet === thesisWallet);
    const current = likeState[thesisWallet] ?? { likes: post?.likes ?? 0, likedByMe: post?.likedByMe ?? false };
    setLikeState((prev) => ({
      ...prev,
      [thesisWallet]: { likes: current.likedByMe ? current.likes - 1 : current.likes + 1, likedByMe: !current.likedByMe },
    }));
    const result = await likeThesis(keyId, thesisWallet, viewerWallet);
    if (result) {
      recentLike.current[thesisWallet] = 0;
      setLikeState((prev) => ({ ...prev, [thesisWallet]: { likes: result.likes, likedByMe: result.liked } }));
    }
  };

  // All posts newest first; enrich with local like state
  const entries = thesis.map(p => {
    const ls = likeState[p.wallet] ?? { likes: p.likes, likedByMe: p.likedByMe };
    return { ...p, likes: ls.likes, likedByMe: ls.likedByMe };
  });

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-mono-xs font-semibold text-foreground">Thesis Feed</span>
        {entries.length > 0 && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-mono-xs font-bold text-primary">
            {entries.length}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-mono-xs text-muted-foreground">No thesis yet.</p>
          <p className="mt-1 text-mono-xs text-muted-foreground/50">Buy a key and share your conviction.</p>
        </div>
      ) : (
        <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
          {entries.map((entry) => {
            const isOwn = viewerWallet === entry.wallet;
            const canLike = !!viewerWallet && !isOwn;
            return (
              <div key={entry.id} className="px-4 py-4 transition-colors hover:bg-surface-elevated">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <span className="text-mono-xs text-muted-foreground">{truncate(entry.wallet)}</span>
                  <button
                    onClick={() => canLike && handleLike(entry.wallet)}
                    title={!viewerWallet ? "Connect wallet to like" : isOwn ? "Can't like your own thesis" : entry.likedByMe ? "Unlike" : "Like"}
                    className={`flex shrink-0 items-center gap-1.5 transition-colors ${
                      entry.likedByMe ? "text-foreground" : canLike ? "cursor-pointer text-muted-foreground/60 hover:text-foreground" : "cursor-default text-muted-foreground/30"
                    }`}
                  >
                    <Heart filled={entry.likedByMe} size={17} />
                    <span className="tabular-nums text-sm font-medium leading-none">{entry.likes}</span>
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-foreground">{entry.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SocialLinks({ xUrl, telegramUrl, websiteUrl, commUrl }: {
  xUrl: string | null; telegramUrl: string | null; websiteUrl: string | null; commUrl: string | null;
}) {
  const links = [
    { href: xUrl,        label: "X",        icon: "𝕏" },
    { href: telegramUrl, label: "Telegram",  icon: "✈" },
    { href: websiteUrl,  label: "Website",   icon: "🌐" },
    { href: commUrl,     label: "Community", icon: "💬" },
  ].filter(l => l.href);
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-2">
      {links.map(l => (
        <a
          key={l.label}
          href={l.href!}
          target="_blank"
          rel="noreferrer"
          title={l.label}
          className="flex h-6 w-6 items-center justify-center rounded border border-border bg-surface text-mono-xs text-muted-foreground hover:text-foreground hover:border-primary transition"
        >
          {l.icon}
        </a>
      ))}
    </div>
  );
}

function CreatorPanel({ keyId, creatorWallet, xUrl, telegramUrl, websiteUrl, commUrl, onSaved }: {
  keyId: string; creatorWallet: string;
  xUrl: string | null; telegramUrl: string | null; websiteUrl: string | null; commUrl: string | null;
  onSaved: () => void;
}) {
  const { publicKey, connected } = useWallet();
  const isCreator = connected && publicKey?.toBase58() === creatorWallet;
  const [open, setOpen] = useState(false);
  const [x, setX] = useState(xUrl ?? "");
  const [tg, setTg] = useState(telegramUrl ?? "");
  const [web, setWeb] = useState(websiteUrl ?? "");
  const [comm, setComm] = useState(commUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!isCreator) return null;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const ok = await updateKeySocials(keyId, {
        x_url: x.trim() || null,
        telegram_url: tg.trim() || null,
        website_url: web.trim() || null,
        comm_url: comm.trim() || null,
      });
      if (!ok) { setMsg("Failed to save links"); return; }
      setMsg("Saved!");
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <button onClick={() => setOpen(v => !v)} className="flex w-full cursor-pointer items-center justify-between text-sm font-semibold text-muted-foreground hover:text-foreground">
        <span>Creator settings</span>
        <span className="text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          {[
            { label: "X (Twitter)", val: x, set: setX, placeholder: "https://x.com/yourhandle" },
            { label: "Telegram",    val: tg, set: setTg, placeholder: "https://t.me/yourchannel" },
            { label: "Website",     val: web, set: setWeb, placeholder: "https://yoursite.com" },
            { label: "Community",   val: comm, set: setComm, placeholder: "https://yourcomm.com" },
          ].map(({ label, val, set, placeholder }) => (
            <div key={label}>
              <label className="text-xs text-muted-foreground">{label}</label>
              <input value={val} onChange={e => set(e.target.value)} placeholder={placeholder}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm outline-none focus:border-primary" />
            </div>
          ))}
          {msg && <p className={`text-sm ${msg === "Saved!" ? "text-success" : "text-destructive"}`}>{msg}</p>}
          <button onClick={save} disabled={busy}
            className="w-full cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function Heart({ filled, size = 15 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
