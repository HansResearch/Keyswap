import { Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { WalletName } from "@solana/wallet-adapter-base";
import { truncate } from "@/lib/keys-store";
import { fetchTicker, type ApiTickerItem } from "@/lib/api";
import { getBuyPrice } from "@/lib/pricing";

function pct24h(item: ApiTickerItem): number {
  const pNow = getBuyPrice(item.supply, 1);
  const pOld = getBuyPrice(Math.max(0, item.supply_24h_ago), 1);
  if (pOld === 0) return 0;
  return ((pNow - pOld) / pOld) * 100;
}

function priceDisplay(supply: number): string {
  const lamports = getBuyPrice(supply, 1);
  const sol = lamports / 1e9;
  if (sol < 0.001) return "<0.001";
  return sol.toFixed(3);
}

function TickerBar() {
  const [items, setItems] = useState<ApiTickerItem[]>([]);

  useEffect(() => {
    fetchTicker().then(setItems);
    const id = setInterval(() => fetchTicker().then(setItems), 30_000);
    return () => clearInterval(id);
  }, []);

  if (items.length === 0) return null;

  const doubled = [...items, ...items];

  return (
    <div className="overflow-hidden border-b border-border bg-surface py-1.5 select-none">
      <div className="flex w-max animate-ticker gap-0" style={{ willChange: "transform" }}>
        {doubled.map((item, i) => {
          const change = pct24h(item);
          const positive = change >= 0;
          return (
            <span key={i} className="flex items-center gap-1.5 px-5 text-mono-xs whitespace-nowrap">
              <span className="text-foreground font-semibold">{item.name.toUpperCase()}</span>
              <span className="text-muted-foreground">{priceDisplay(item.supply)} SOL</span>
              <span className={positive ? "text-success" : "text-destructive"}>
                {positive ? "+" : ""}{change.toFixed(1)}%
              </span>
              <span className="ml-3 text-border">·</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function useWalletBalance(publicKey: ReturnType<typeof useWallet>["publicKey"]) {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    let cancelled = false;
    const fetch = async () => {
      try {
        const lamports = await connection.getBalance(publicKey);
        if (!cancelled) setBalance(lamports / 1e9);
      } catch {}
    };
    fetch();
    const id = setInterval(fetch, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [publicKey, connection]);

  return balance;
}

export function Header() {
  const navigate = useNavigate();
  const { publicKey, disconnect, connecting, connected, select, wallets } = useWallet();
  const [showMenu, setShowMenu] = useState(false);
  const balance = useWalletBalance(publicKey);

  const walletAddress = publicKey?.toBase58() ?? null;

  const handleConnect = (walletName: WalletName) => {
    select(walletName);
    setShowMenu(false);
  };

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <TickerBar />
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-8">
          <Link to="/" className="flex shrink-0 items-center gap-2 text-mono-xs font-bold text-primary tracking-[0.25em]">
            <img src="/logo.png" alt="" className="h-8 w-8 sm:h-9 sm:w-9" />
            <span className="hidden xs:inline sm:inline">KEYS</span>
          </Link>
          {/* Nav: always visible. Items are short enough to fit on mobile. */}
          <nav className="flex items-center gap-3 sm:gap-6">
            <Link to="/" className="text-mono-xs text-foreground hover:text-primary" activeProps={{ className: "text-primary" }}>Market</Link>
            <Link to="/portfolio" className="text-mono-xs text-foreground hover:text-primary" activeProps={{ className: "text-primary" }}>Portfolio</Link>
            <Link to="/guide" className="text-mono-xs text-muted-foreground hover:text-primary transition" activeProps={{ className: "text-primary" }}>Guide</Link>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {connected && (
            <button
              onClick={() => navigate({ to: "/launch" })}
              className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-mono-xs font-semibold text-primary transition hover:bg-primary/20 sm:px-3"
            >
              {/* On mobile, save space: just "+ Launch" */}
              <span className="sm:hidden">+ Launch</span>
              <span className="hidden sm:inline">+ Launch Key</span>
            </button>
          )}

          <div className="relative">
            {connected && walletAddress ? (
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-mono-xs text-muted-foreground hover:text-foreground sm:gap-2 sm:px-3"
              >
                <span className="h-2 w-2 rounded-full bg-success" />
                {/* Balance shown only on larger screens to keep the pill compact on mobile */}
                {balance !== null && (
                  <span className="hidden tabular-nums text-foreground sm:inline">{balance.toFixed(2)} SOL</span>
                )}
                <span className="hidden text-border sm:inline">·</span>
                <span>{truncate(walletAddress)}</span>
              </button>
            ) : (
              <button
                onClick={() => setShowMenu((v) => !v)}
                disabled={connecting}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-mono-xs text-muted-foreground hover:text-foreground disabled:opacity-50 sm:gap-2 sm:px-3"
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                <span className="sm:hidden">{connecting ? "…" : "Connect"}</span>
                <span className="hidden sm:inline">{connecting ? "Connecting…" : "Connect Wallet"}</span>
              </button>
            )}

            {showMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border border-border bg-surface-elevated p-2 shadow-lg">
                {connected && walletAddress ? (
                  <>
                    <p className="mb-2 truncate px-2 py-1 text-mono-xs text-muted-foreground">{walletAddress}</p>
                    <button
                      onClick={() => { disconnect(); setShowMenu(false); }}
                      className="w-full rounded px-2 py-1.5 text-left text-mono-xs text-destructive hover:bg-muted"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (() => {
                  // Filter to Phantom only. Auto-discovered wallets (Metamask,
                  // Leap, Solflare via Wallet Standard) get hidden here.
                  const allowed = wallets.filter((w) => w.adapter.name === 'Phantom');
                  if (allowed.length === 0) {
                    return (
                      <p className="px-2 py-1 text-mono-xs text-muted-foreground">
                        Install the Phantom browser extension first.
                      </p>
                    );
                  }
                  return (
                    <>
                      <p className="mb-1 px-2 py-1 text-mono-xs text-muted-foreground">Select wallet</p>
                      {allowed.map((w) => (
                        <button
                          key={w.adapter.name}
                          onClick={() => handleConnect(w.adapter.name)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-mono-xs hover:bg-muted"
                        >
                          {w.adapter.icon && (
                            <img src={w.adapter.icon} alt="" className="h-4 w-4 rounded" />
                          )}
                          <span>{w.adapter.name}</span>
                          <span className="ml-auto text-mono-xs text-muted-foreground/60">
                            {w.readyState === 'Installed' ? 'Installed' : 'Not installed'}
                          </span>
                        </button>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {showMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
      )}
    </header>
    </>
  );
}
