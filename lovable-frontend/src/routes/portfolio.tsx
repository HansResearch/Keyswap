import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useKeysStore, loadKeys, formatSol, truncate } from "@/lib/keys-store";
import { priceAt } from "@/lib/keys-store";
import { fmtUsd } from "@/lib/pricing";
import { useSolPrice } from "@/lib/use-sol-price";
import { KeyAvatar } from "@/components/KeyAvatar";

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});

type HoldingRow = {
  keyId: string;
  name: string;
  pfp: string | null;
  supply: number;
  balance: number;
  valueInLamports: number;
};

function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const keys = useKeysStore((s) => s.keys);
  const keysLoading = useKeysStore((s) => s.loading);
  const solPrice = useSolPrice();
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  // Start `true` so the very first render shows the loader, not the empty state.
  // The previous code defaulted to `false` → empty state flashed for one frame
  // before the effect kicked in and set it to true.
  const [holdingsFetched, setHoldingsFetched] = useState(false);

  useEffect(() => { loadKeys(); }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      // Disconnected → not loading anything
      setHoldings([]);
      setHoldingsFetched(true);
      return;
    }
    if (keys.length === 0) {
      // Keys list not loaded yet — stay in loading state, will re-fire below
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      const { fetchHolderBalance, getSubjectNamePda } = await import("@/lib/program");
      const rows: HoldingRow[] = [];

      await Promise.all(
        keys.map(async (k) => {
          try {
            const namePda = getSubjectNamePda(k.id);
            const balance = await fetchHolderBalance(connection, namePda, publicKey!);
            if (balance > 0) {
              const price = priceAt(k.supply);
              rows.push({
                keyId: k.id,
                name: k.name,
                pfp: k.pfp,
                supply: k.supply,
                balance,
                valueInLamports: price * balance,
              });
            }
          } catch {}
        })
      );

      if (!cancelled) {
        rows.sort((a, b) => b.valueInLamports - a.valueInLamports);
        setHoldings(rows);
        setHoldingsFetched(true);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [connected, publicKey, connection, keys]);

  // True until BOTH the keys list AND the per-key balances have loaded.
  // This is the source-of-truth for "show loader vs. show empty state".
  const isLoading = !holdingsFetched || (connected && keysLoading);

  const totalValue = holdings.reduce((s, h) => s + h.valueInLamports, 0);

  if (!connected) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-6">
        <p className="text-mono-xs text-muted-foreground">Connect your wallet to view your portfolio</p>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Portfolio</h1>
            <p className="mt-1 text-mono-xs text-muted-foreground">
              {publicKey ? truncate(publicKey.toBase58()) : ""}
            </p>
          </div>
          <div className="sm:text-right">
            <div className="text-mono-xs text-muted-foreground">Total Value</div>
            <div className="mt-1 text-base font-semibold tabular-nums">
              {solPrice > 0 ? fmtUsd(totalValue, solPrice) : `${formatSol(totalValue)} SOL`}
            </div>
            {solPrice > 0 && (
              <div className="text-mono-xs text-muted-foreground/60">{formatSol(totalValue)} SOL</div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
                  <th className="px-3 py-3 text-left font-normal sm:px-4">Key</th>
                  <th className="px-3 py-3 text-right font-normal sm:px-4">Held</th>
                  <th className="hidden px-4 py-3 text-right font-normal sm:table-cell">% of Supply</th>
                  <th className="px-3 py-3 text-right font-normal sm:px-4">Value</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`pf-skel-${i}`} className="border-b border-border/50">
                    <td className="px-3 py-3 sm:px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 animate-pulse rounded-full bg-muted/50" />
                        <div className="h-3 w-20 animate-pulse rounded bg-muted/50" />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right sm:px-4"><div className="ml-auto h-3 w-10 animate-pulse rounded bg-muted/50" /></td>
                    <td className="hidden px-4 py-3 text-right sm:table-cell"><div className="ml-auto h-3 w-12 animate-pulse rounded bg-muted/50" /></td>
                    <td className="px-3 py-3 text-right sm:px-4"><div className="ml-auto h-3 w-20 animate-pulse rounded bg-muted/50" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : holdings.length === 0 ? (
          <div className="rounded-lg border border-border py-16 text-center">
            <p className="text-mono-xs text-muted-foreground">You don't hold any keys yet</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
                  <th className="px-3 py-3 text-left font-normal sm:px-4">Key</th>
                  <th className="px-3 py-3 text-right font-normal sm:px-4">Held</th>
                  <th className="hidden px-4 py-3 text-right font-normal sm:table-cell">% of Supply</th>
                  <th className="px-3 py-3 text-right font-normal sm:px-4">Value</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr
                    key={h.keyId}
                    onClick={() => navigate({ to: "/k/$keyId", params: { keyId: h.keyId } })}
                    className="cursor-pointer border-b border-border/50 transition hover:bg-surface"
                  >
                    <td className="px-3 py-3 sm:px-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <KeyAvatar pfp={h.pfp} name={h.name} size={32} />
                        <span className="truncate text-sm font-semibold">{h.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums sm:px-4">{h.balance}</td>
                    <td className="hidden px-4 py-3 text-right text-mono-xs tabular-nums sm:table-cell">
                      {h.supply > 0 ? ((h.balance / h.supply) * 100).toFixed(2) : "0.00"}%
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums sm:px-4">
                      <div>{solPrice > 0 ? fmtUsd(h.valueInLamports, solPrice) : `${formatSol(h.valueInLamports)} SOL`}</div>
                      {solPrice > 0 && (
                        <div className="text-mono-xs text-muted-foreground/60">{formatSol(h.valueInLamports)} SOL</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
