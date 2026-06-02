import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useKeysStore, volume24h, formatSol, marketcapAt, priceAt, loadKeys, truncate } from "@/lib/keys-store";
import { fmtUsd } from "@/lib/pricing";
import { useSolPrice } from "@/lib/use-sol-price";
import { fetchRecentTrades, type ApiTrade } from "@/lib/api";
import { KeyAvatar } from "@/components/KeyAvatar";

export const Route = createFileRoute("/")({
  component: Home,
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

function Home() {
  const keys = useKeysStore((s) => s.keys);
  const loading = useKeysStore((s) => s.loading);
  const [tab, setTab] = useState<"trending" | "new">("trending");
  const navigate = useNavigate();
  const solPrice = useSolPrice();
  const [recentTrades, setRecentTrades] = useState<ApiTrade[] | null>(null); // null = not loaded yet
  const intervalRef = useRef<number | null>(null);

  useEffect(() => { loadKeys(); }, []);

  useEffect(() => {
    const load = () => fetchRecentTrades(20).then(setRecentTrades);
    load();
    intervalRef.current = window.setInterval(load, 4_000);
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, []);

  const sorted = [...keys].sort((a, b) =>
    tab === "trending" ? volume24h(b) - volume24h(a) : b.createdAt - a.createdAt
  );

  const totalMc = keys.reduce((s, k) => s + marketcapAt(k.supply), 0);
  const totalVol = keys.reduce((s, k) => s + volume24h(k), 0);

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Market</h1>
            <p className="mt-1 text-mono-xs text-muted-foreground">
              Trade keys on Solana
            </p>
          </div>
          {/* Stats — 3-up grid on mobile, inline row on desktop */}
          <div className="grid grid-cols-3 gap-4 sm:flex sm:gap-8">
            <Stat label="Total Keys" value={keys.length.toString()} />
            <Stat label="24H Volume" value={solPrice > 0 ? fmtUsd(totalVol, solPrice) : `${formatSol(totalVol)} SOL`} />
            <Stat label="Total MC" value={solPrice > 0 ? fmtUsd(totalMc, solPrice) : `${formatSol(totalMc)} SOL`} />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* Left: market table */}
          <div>
            <div className="mb-4 flex items-center gap-1 border-b border-border">
              <TabBtn active={tab === "trending"} onClick={() => setTab("trending")}>Trending</TabBtn>
              <TabBtn active={tab === "new"} onClick={() => setTab("new")}>New</TabBtn>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
                    <th className="hidden px-3 py-3 text-left font-normal sm:table-cell sm:px-4">#</th>
                    <th className="px-3 py-3 text-left font-normal sm:px-4">Key</th>
                    <th className="px-3 py-3 text-right font-normal sm:px-4">Price</th>
                    <th className="px-3 py-3 text-right font-normal sm:px-4">MC</th>
                    <th className="hidden px-4 py-3 text-right font-normal md:table-cell">24H Vol</th>
                    <th className="hidden px-4 py-3 text-right font-normal md:table-cell">Supply</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && sorted.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-b border-border/50">
                        <td className="hidden px-3 py-3 sm:table-cell sm:px-4"><Skeleton w="w-6" /></td>
                        <td className="px-3 py-3 sm:px-4">
                          <div className="flex items-center gap-3">
                            <Skeleton w="w-8 h-8 rounded-full" />
                            <div className="space-y-1.5">
                              <Skeleton w="w-20" />
                              <Skeleton w="w-10 h-2.5" />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right sm:px-4"><Skeleton w="w-16 ml-auto" /></td>
                        <td className="px-3 py-3 text-right sm:px-4"><Skeleton w="w-20 ml-auto" /></td>
                        <td className="hidden px-4 py-3 text-right md:table-cell"><Skeleton w="w-14 ml-auto" /></td>
                        <td className="hidden px-4 py-3 text-right md:table-cell"><Skeleton w="w-8 ml-auto" /></td>
                      </tr>
                    ))
                  ) : sorted.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-16 text-center text-mono-xs text-muted-foreground">No keys yet — launch the first one</td></tr>
                  ) : sorted.map((k, i) => {
                    const mc = marketcapAt(k.supply);
                    const vol = volume24h(k);
                    const keyPrice = priceAt(k.supply);
                    return (
                      <tr
                        key={k.id}
                        onClick={() => navigate({ to: "/k/$keyId", params: { keyId: k.id } })}
                        className="group cursor-pointer border-b border-border/50 transition hover:bg-surface"
                      >
                        <td className="hidden px-3 py-3 text-mono-xs text-muted-foreground sm:table-cell sm:px-4">{(i + 1).toString().padStart(2, "0")}</td>
                        <td className="px-3 py-3 sm:px-4">
                          <div className="flex items-center gap-3">
                            <KeyAvatar pfp={k.pfp} name={k.name} size={32} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold group-hover:text-primary">{k.name}</div>
                              <div className="text-mono-xs text-muted-foreground">{k.symbol}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-sm tabular-nums sm:px-4">
                          {solPrice > 0 ? fmtUsd(keyPrice, solPrice) : `${formatSol(keyPrice)} SOL`}
                        </td>
                        <td className="px-3 py-3 text-right text-sm tabular-nums sm:px-4">
                          {solPrice > 0 ? fmtUsd(mc, solPrice) : `${formatSol(mc)} SOL`}
                        </td>
                        <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-muted-foreground md:table-cell">
                          {vol > 0 ? (solPrice > 0 ? fmtUsd(vol, solPrice) : `${formatSol(vol)} SOL`) : '—'}
                        </td>
                        <td className="hidden px-4 py-3 text-right text-sm tabular-nums md:table-cell">{k.supply}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: live trades feed */}
          <div>
            <div className="mb-4 flex items-center gap-2 border-b border-border pb-2.5">
              <span className="text-mono-xs font-semibold">Live Trades</span>
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left font-normal">Key</th>
                    <th className="px-4 py-3 text-right font-normal">Amount</th>
                    <th className="px-4 py-3 text-right font-normal">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades === null ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`tskel-${i}`} className="border-b border-border/50">
                        <td className="px-4 py-3"><Skeleton w="w-16" /></td>
                        <td className="px-4 py-3 text-right"><Skeleton w="w-14 ml-auto" /></td>
                        <td className="px-4 py-3 text-right"><Skeleton w="w-8 ml-auto" /></td>
                      </tr>
                    ))
                  ) : recentTrades.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-mono-xs text-muted-foreground">No trades yet</td></tr>
                  ) : recentTrades.slice(0, 17).map((t) => {
                    const isBuy = t.trade_type === 'BUY' || t.trade_type === 'CREATE';
                    const ts = t.block_time ? new Date(t.block_time).getTime() : Date.now();
                    const amt = solPrice > 0 ? fmtUsd(t.price_sol, solPrice) : `${formatSol(t.price_sol)} SOL`;
                    return (
                      <tr
                        key={t.id}
                        onClick={() => navigate({ to: "/k/$keyId", params: { keyId: t.name } })}
                        className="cursor-pointer border-b border-border/50 transition hover:bg-surface"
                      >
                        <td className="px-4 py-3 text-sm font-semibold">{t.name}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${isBuy ? "text-success" : "text-destructive"}`}>
                          {isBuy ? "+" : "-"}{amt}
                        </td>
                        <td className="px-4 py-3 text-right text-mono-xs text-muted-foreground tabular-nums">{timeAgo(ts)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-mono-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// Subtle pulsing skeleton for loading placeholders. `w` lets the caller pass
// width/height/shape (e.g. "w-20", "w-8 h-8 rounded-full") via Tailwind classes.
function Skeleton({ w = 'w-16' }: { w?: string }) {
  return <div className={`inline-block h-3 rounded bg-muted/50 animate-pulse ${w}`} />
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative cursor-pointer px-4 py-2.5 text-mono-xs font-semibold transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
      {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
    </button>
  );
}
