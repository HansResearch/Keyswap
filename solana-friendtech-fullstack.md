# Solana FriendTech — Full Stack Web App Plan

---

## Tech Stack Overview

| Layer | Technology | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) | SSR for SEO, easy API routes, Vercel deploy |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent, dark mode ready |
| Wallet | `@solana/wallet-adapter-react` | Standard, supports Phantom/Backpack/Solflare |
| On-chain reads | `@coral-xyz/anchor` + `@solana/web3.js` | Direct PDA reads, transaction building |
| Backend | Next.js API Routes | Collocated with frontend, no extra server |
| Database | PostgreSQL via Supabase | Free tier, realtime subscriptions built-in |
| ORM | Prisma | Type-safe DB queries |
| Indexer | Helius Webhooks | Simplest way to capture on-chain events |
| Auth | Wallet signature → JWT | No passwords, crypto-native |
| Chat | XMTP | Decentralized, wallet-native messaging |
| Deployment | Vercel (frontend + API) | Zero config, auto preview environments |

---

## Repository Structure

```
friendtech-web/
├── app/                          ← Next.js App Router
│   ├── layout.tsx                ← root layout, wallet provider
│   ├── page.tsx                  ← / discovery feed
│   ├── profile/
│   │   └── [address]/
│   │       └── page.tsx          ← /profile/:address
│   ├── portfolio/
│   │   └── page.tsx              ← /portfolio (auth gated)
│   ├── activity/
│   │   └── page.tsx              ← /activity global feed
│   └── api/
│       ├── auth/
│       │   ├── nonce/route.ts    ← GET nonce for signing
│       │   └── verify/route.ts   ← POST signature → JWT
│       ├── events/route.ts       ← POST Helius webhook receiver
│       ├── subjects/
│       │   ├── route.ts          ← GET all subjects (trending)
│       │   └── [address]/
│       │       └── route.ts      ← GET single subject data
│       ├── portfolio/
│       │   └── [wallet]/route.ts ← GET holdings for a wallet
│       └── activity/route.ts     ← GET global trade feed
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   └── Sidebar.tsx
│   ├── trade/
│   │   ├── TradeWidget.tsx       ← buy/sell UI (core component)
│   │   ├── PriceDisplay.tsx
│   │   └── TradeConfirmModal.tsx
│   ├── profile/
│   │   ├── ProfileHeader.tsx
│   │   ├── HoldersList.tsx
│   │   └── PriceChart.tsx
│   ├── discovery/
│   │   ├── SubjectCard.tsx
│   │   └── TrendingFeed.tsx
│   ├── portfolio/
│   │   └── HoldingRow.tsx
│   └── shared/
│       ├── WalletButton.tsx
│       ├── SolAmount.tsx         ← formats lamports → SOL display
│       └── AddressDisplay.tsx    ← truncates pubkey, links to profile
├── lib/
│   ├── anchor.ts                 ← Anchor program client setup
│   ├── pricing.ts                ← bonding curve math (mirrors contract)
│   ├── auth.ts                   ← JWT sign/verify helpers
│   ├── helius.ts                 ← webhook signature verification
│   └── solana.ts                 ← RPC connection, helper utils
├── hooks/
│   ├── useTradeWidget.ts         ← buy/sell transaction logic
│   ├── useSubject.ts             ← fetch + cache subject data
│   ├── usePortfolio.ts           ← fetch holdings for connected wallet
│   └── useAuth.ts                ← wallet sign-in state
├── prisma/
│   └── schema.prisma             ← DB schema
├── middleware.ts                 ← JWT auth middleware for protected routes
└── .env.local                    ← secrets (never commit)
```

---

## Phase 1: Database Schema (`prisma/schema.prisma`)

```prisma
model Subject {
  id            String   @id              // Solana address (base58)
  supply        BigInt   @default(0)
  totalVolume   BigInt   @default(0)      // cumulative SOL traded (lamports)
  tradeCount    Int      @default(0)
  holderCount   Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  trades  Trade[]
  holders Holding[]
}

model Trade {
  id            String   @id @default(cuid())
  signature     String   @unique           // Solana tx signature
  trader        String                     // wallet address
  subject       String                     // creator address
  isBuy         Boolean
  shareAmount   BigInt
  solAmount     BigInt                     // base price in lamports
  protocolFee   BigInt
  subjectFee    BigInt
  supplyAfter   BigInt
  timestamp     DateTime

  subjectRef  Subject @relation(fields: [subject], references: [id])

  @@index([trader])
  @@index([subject])
  @@index([timestamp])
}

model Holding {
  id        String  @id @default(cuid())
  holder    String                         // wallet address
  subject   String                         // creator address
  balance   BigInt  @default(0)

  subjectRef Subject @relation(fields: [subject], references: [id])

  @@unique([holder, subject])
  @@index([holder])
  @@index([subject])
}

model AuthNonce {
  wallet    String   @id
  nonce     String
  expiresAt DateTime
}
```

---

## Phase 2: Indexer (Helius Webhook)

### Setup in Helius Dashboard
1. Go to helius.dev → Webhooks → Create Webhook
2. URL: `https://yourapp.vercel.app/api/events`
3. Transaction type: **Program** 
4. Address: your deployed program ID
5. Copy the webhook secret → `HELIUS_WEBHOOK_SECRET` in env

### Webhook Handler (`app/api/events/route.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyHeliusSignature } from "@/lib/helius";

export async function POST(req: NextRequest) {
  // 1. Verify the request is actually from Helius
  const rawBody = await req.text();
  const signature = req.headers.get("helius-signature");
  if (!verifyHeliusSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = JSON.parse(rawBody);

  for (const event of events) {
    // 2. Parse the TradeEvent from program logs
    const tradeData = parseTradeEvent(event);
    if (!tradeData) continue;

    // 3. Upsert in a transaction — idempotent (webhook can fire twice)
    await prisma.$transaction([

      // Insert trade record
      prisma.trade.upsert({
        where: { signature: tradeData.signature },
        update: {},  // if already exists, skip
        create: tradeData,
      }),

      // Upsert subject state
      prisma.subject.upsert({
        where: { id: tradeData.subject },
        update: {
          supply: tradeData.supplyAfter,
          totalVolume: { increment: tradeData.solAmount },
          tradeCount: { increment: 1 },
        },
        create: {
          id: tradeData.subject,
          supply: tradeData.supplyAfter,
          totalVolume: tradeData.solAmount,
          tradeCount: 1,
        },
      }),

      // Upsert holder balance
      prisma.holding.upsert({
        where: { holder_subject: { holder: tradeData.trader, subject: tradeData.subject } },
        update: {
          balance: tradeData.isBuy
            ? { increment: tradeData.shareAmount }
            : { decrement: tradeData.shareAmount },
        },
        create: {
          holder: tradeData.trader,
          subject: tradeData.subject,
          balance: tradeData.isBuy ? tradeData.shareAmount : 0n,
        },
      }),
    ]);

    // 4. Update holder count (separate query — count distinct holders with balance > 0)
    const holderCount = await prisma.holding.count({
      where: { subject: tradeData.subject, balance: { gt: 0n } },
    });
    await prisma.subject.update({
      where: { id: tradeData.subject },
      data: { holderCount },
    });
  }

  return NextResponse.json({ ok: true });
}

function parseTradeEvent(event: any) {
  // Helius returns structured data for known program events
  // Parse the TradeEvent fields from event.events or event.logs
  // Implementation depends on Helius enhanced transaction format
  try {
    const log = event.events?.find((e: any) => e.type === "TRADE"); // adjust to actual format
    if (!log) return null;
    return {
      signature: event.signature,
      trader: log.trader,
      subject: log.subject,
      isBuy: log.isBuy,
      shareAmount: BigInt(log.shareAmount),
      solAmount: BigInt(log.solAmount),
      protocolFee: BigInt(log.protocolFee),
      subjectFee: BigInt(log.subjectFee),
      supplyAfter: BigInt(log.supply),
      timestamp: new Date(event.timestamp * 1000),
    };
  } catch {
    return null;
  }
}
```

---

## Phase 3: Authentication (Wallet Sign-In)

### Why: gated chat access, personalized portfolio, anti-spam

### Flow
```
1. User clicks "Sign In"
2. Frontend calls GET /api/auth/nonce → { nonce: "Sign in to FriendTech: abc123" }
3. Wallet signs the nonce message (no transaction, no SOL cost)
4. Frontend calls POST /api/auth/verify → { token: "eyJ..." }
5. JWT stored in httpOnly cookie
6. Protected routes/API calls use the cookie
```

### Nonce endpoint (`app/api/auth/nonce/route.ts`)
```typescript
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

  const nonce = `Sign in to FriendTech: ${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  await prisma.authNonce.upsert({
    where: { wallet },
    update: { nonce, expiresAt },
    create: { wallet, nonce, expiresAt },
  });

  return NextResponse.json({ nonce });
}
```

### Verify endpoint (`app/api/auth/verify/route.ts`)
```typescript
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import * as jose from "jose";

export async function POST(req: NextRequest) {
  const { wallet, signature, nonce } = await req.json();

  // 1. Look up stored nonce
  const stored = await prisma.authNonce.findUnique({ where: { wallet } });
  if (!stored || stored.nonce !== nonce || stored.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid or expired nonce" }, { status: 401 });
  }

  // 2. Verify signature
  const messageBytes = new TextEncoder().encode(nonce);
  const sigBytes = Buffer.from(signature, "base64");
  const pubkeyBytes = new PublicKey(wallet).toBytes();
  const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);

  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  // 3. Delete nonce (single use)
  await prisma.authNonce.delete({ where: { wallet } });

  // 4. Issue JWT
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new jose.SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);

  // 5. Set httpOnly cookie
  const response = NextResponse.json({ ok: true });
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
```

---

## Phase 4: API Endpoints

### `GET /api/subjects` — Discovery feed
```typescript
// Query params: sort=volume|trades|new, limit=20, offset=0
export async function GET(req: NextRequest) {
  const sort = req.nextUrl.searchParams.get("sort") ?? "volume";
  const subjects = await prisma.subject.findMany({
    orderBy: sort === "new" ? { createdAt: "desc" }
           : sort === "trades" ? { tradeCount: "desc" }
           : { totalVolume: "desc" },
    take: 20,
    skip: Number(req.nextUrl.searchParams.get("offset") ?? 0),
  });
  return NextResponse.json(subjects);
}
```

### `GET /api/subjects/[address]` — Single subject
```typescript
export async function GET(req: NextRequest, { params }: { params: { address: string } }) {
  const [subject, recentTrades, topHolders] = await Promise.all([
    prisma.subject.findUnique({ where: { id: params.address } }),
    prisma.trade.findMany({
      where: { subject: params.address },
      orderBy: { timestamp: "desc" },
      take: 20,
    }),
    prisma.holding.findMany({
      where: { subject: params.address, balance: { gt: 0n } },
      orderBy: { balance: "desc" },
      take: 10,
    }),
  ]);
  return NextResponse.json({ subject, recentTrades, topHolders });
}
```

### `GET /api/portfolio/[wallet]` — Holdings for a wallet
```typescript
export async function GET(req: NextRequest, { params }: { params: { wallet: string } }) {
  const holdings = await prisma.holding.findMany({
    where: { holder: params.wallet, balance: { gt: 0n } },
    include: { subjectRef: true },
    orderBy: { balance: "desc" },
  });
  return NextResponse.json(holdings);
}
```

### `GET /api/activity` — Global trade feed
```typescript
export async function GET(req: NextRequest) {
  const trades = await prisma.trade.findMany({
    orderBy: { timestamp: "desc" },
    take: 50,
  });
  return NextResponse.json(trades);
}
```

---

## Phase 5: Frontend Pages & Components

### 5.1 Root Layout — Wallet Provider

```tsx
// app/layout.tsx
"use client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, BackpackWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

const wallets = [new PhantomWalletAdapter(), new BackpackWalletAdapter()];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConnectionProvider endpoint={process.env.NEXT_PUBLIC_RPC_URL!}>
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
              <Navbar />
              {children}
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </body>
    </html>
  );
}
```

---

### 5.2 Trade Widget — Core Component

This is the most important UI component. Lives on every profile page.

```tsx
// components/trade/TradeWidget.tsx
"use client";

type Mode = "buy" | "sell";

export function TradeWidget({ subject }: { subject: string }) {
  const [mode, setMode] = useState<Mode>("buy");
  const [amount, setAmount] = useState(1);
  const { publicKey } = useWallet();
  const { execute, loading, error } = useTradeWidget(subject);

  // Compute price client-side using same bonding curve math as contract
  const { supply } = useSubject(subject);
  const price = mode === "buy"
    ? getBuyPrice(supply, amount)
    : getSellPrice(supply, amount);
  const protocolFee = price * PROTOCOL_FEE_PERCENT;
  const subjectFee  = price * SUBJECT_FEE_PERCENT;
  const total = mode === "buy" ? price + protocolFee + subjectFee
                               : price - protocolFee - subjectFee;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
      {/* Buy / Sell toggle */}
      <div className="flex rounded-lg bg-zinc-800 p-1">
        {(["buy", "sell"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors
              ${mode === m ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Amount selector */}
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">Amount</label>
        <div className="flex gap-2">
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              onClick={() => setAmount(n)}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors
                ${amount === n ? "border-white text-white" : "border-zinc-700 text-zinc-400"}`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
            className="flex-1 bg-zinc-800 rounded-md px-3 py-1.5 text-sm text-white
                       border border-zinc-700 focus:outline-none focus:border-white"
          />
        </div>
      </div>

      {/* Price breakdown */}
      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-zinc-400">
          <span>Price</span>
          <SolAmount lamports={price} />
        </div>
        <div className="flex justify-between text-zinc-400">
          <span>Protocol fee (5%)</span>
          <SolAmount lamports={protocolFee} />
        </div>
        <div className="flex justify-between text-zinc-400">
          <span>Creator fee (5%)</span>
          <SolAmount lamports={subjectFee} />
        </div>
        <div className="flex justify-between text-white font-medium border-t border-zinc-700 pt-2">
          <span>{mode === "buy" ? "You pay" : "You receive"}</span>
          <SolAmount lamports={total} />
        </div>
      </div>

      {/* Action button */}
      <button
        onClick={() => execute(mode, amount)}
        disabled={!publicKey || loading}
        className="w-full py-3 rounded-lg font-medium text-sm transition-colors
          bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Confirming..." : `${mode === "buy" ? "Buy" : "Sell"} ${amount} Share${amount > 1 ? "s" : ""}`}
      </button>

      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
```

---

### 5.3 Trade Hook — Transaction Logic

```typescript
// hooks/useTradeWidget.ts
export function useTradeWidget(subjectAddress: string) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = async (mode: "buy" | "sell", amount: number) => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);

    try {
      const program = getAnchorProgram(connection);
      const subject = new PublicKey(subjectAddress);

      const tx = mode === "buy"
        ? await program.methods
            .buyShares(new BN(amount))
            .accounts({
              buyer: publicKey,
              subject,
              // ... PDA derivations
            })
            .transaction()
        : await program.methods
            .sellShares(new BN(amount))
            .accounts({
              seller: publicKey,
              subject,
              // ... PDA derivations
            })
            .transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      // Optimistic UI update — don't wait for indexer
      // (Supabase realtime or polling will catch up)
    } catch (e: any) {
      setError(e.message ?? "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return { execute, loading, error };
}
```

---

### 5.4 Profile Page

```
/profile/[address]
├── ProfileHeader        ← avatar (from social graph or Solana domain), address, share stats
├── PriceChart           ← line chart of price over time (from Trade table)
├── TradeWidget          ← buy / sell panel
├── HoldersList          ← top 10 holders with balances
└── ActivityFeed         ← trades for this subject only
```

**Price chart data:**
```typescript
// Derive price at each trade from supply at that point
// price_after_trade_n = getPrice(supply_n - amount_n, amount_n)
// Build time series from Trade table ordered by timestamp
```

---

### 5.5 Discovery Page (`/`)

```
/
├── Hero stat bar          ← total volume, active subjects, 24h trades
├── Sort tabs              ← Trending | New | Top Volume
└── SubjectCard grid
    ├── Address (truncated, links to profile)
    ├── Current price (computed from supply)
    ├── 24h price change %
    ├── Holder count
    └── Buy button (quick trade, opens modal)
```

---

### 5.6 Portfolio Page (`/portfolio`)

Auth-gated. Shows connected wallet's holdings.

```
/portfolio
├── Total value            ← sum of (balance × current_sell_price) for each holding
├── Holdings table
│   ├── Creator address
│   ├── Shares held
│   ├── Current sell value
│   ├── Est. P&L (if you track avg buy price — optional)
│   └── Trade button
└── Trade history          ← all trades by this wallet
```

---

## Phase 6: Bonding Curve Math (Client-Side Mirror)

Mirror the contract math in TypeScript so the UI shows prices without an RPC call on every keystroke.

```typescript
// lib/pricing.ts
import BN from "bn.js";

export function getPrice(supply: bigint, amount: bigint): bigint {
  const s = supply;
  const a = amount;

  const sum1 = s === 0n ? 0n
    : (s - 1n) * s * (2n * (s - 1n) + 1n) / 6n;

  const sum2 = (s === 0n && a === 1n) ? 0n
    : (s - 1n + a) * (s + a) * (2n * (s - 1n + a) + 1n) / 6n;

  const summation = sum2 - sum1;
  return summation * 1_000_000_000n / 16_000n;  // lamports
}

export function getBuyPrice(supply: bigint, amount: bigint): bigint {
  return getPrice(supply, amount);
}

export function getSellPrice(supply: bigint, amount: bigint): bigint {
  return getPrice(supply - amount, amount);
}

export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  return sol < 0.001 ? "< 0.001 SOL" : `${sol.toFixed(4)} SOL`;
}

// Fee constants — must match contract
export const PROTOCOL_FEE_PERCENT = 0.05;   // 5%
export const SUBJECT_FEE_PERCENT  = 0.05;   // 5%
```

---

## Phase 7: Chat (XMTP Integration)

Share holders get access to a creator's chat. Gated by on-chain balance check.

### How it works
```
1. User holds ≥ 1 share of creator X (verified via BalanceState PDA or DB)
2. User opens /profile/X → chat panel appears
3. XMTP client initializes with user's wallet
4. Chat is a group conversation on XMTP keyed to creator's address
5. Backend verifies balance before returning the group invite
```

### Setup
```bash
npm install @xmtp/xmtp-js
```

```typescript
// components/chat/ChatPanel.tsx
import { Client } from "@xmtp/xmtp-js";

export function ChatPanel({ subject, userBalance }: { subject: string, userBalance: bigint }) {
  const { wallet } = useWallet();
  const [client, setClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    if (!wallet || userBalance < 1n) return;

    async function init() {
      const xmtp = await Client.create(wallet, { env: "production" });
      setClient(xmtp);
      // Load or create conversation with subject address
      const conversation = await xmtp.conversations.newConversation(subject);
      const msgs = await conversation.messages();
      setMessages(msgs);
    }
    init();
  }, [wallet, subject, userBalance]);

  if (userBalance < 1n) return (
    <div className="p-4 text-zinc-400 text-sm text-center">
      Buy at least 1 share to access this chat
    </div>
  );

  // render chat UI...
}
```

---

## Phase 8: Environment Variables

```bash
# .env.local

# Solana
NEXT_PUBLIC_RPC_URL=https://mainnet.helius-rpc.com/?api-key=xxx
NEXT_PUBLIC_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID
NEXT_PUBLIC_CLUSTER=mainnet-beta

# Database (Supabase)
DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres

# Auth
JWT_SECRET=your-random-64-char-secret

# Indexer
HELIUS_WEBHOOK_SECRET=your-helius-secret
HELIUS_API_KEY=your-helius-api-key

# XMTP (optional — leave blank for development)
NEXT_PUBLIC_XMTP_ENV=production
```

---

## Phase 9: Build Order (6-Week Plan)

### Week 1 — Foundation
- [ ] Next.js project init with Tailwind + shadcn/ui
- [ ] Wallet adapter integration, connect button working
- [ ] Supabase project + Prisma schema + migrations
- [ ] `lib/anchor.ts` wired to devnet program
- [ ] `lib/pricing.ts` — client-side bonding curve
- [ ] Basic navbar + layout

### Week 2 — Core Trade Flow
- [ ] `TradeWidget` component (buy/sell toggle, amount picker, price display)
- [ ] `useTradeWidget` hook (builds + sends Anchor tx)
- [ ] `useSubject` hook (reads SubjectState PDA for live supply)
- [ ] Trade confirmation modal
- [ ] Skeleton profile page with trade widget

### Week 3 — Indexer + Data
- [ ] Helius webhook endpoint + signature verification
- [ ] `parseTradeEvent` — parse program logs into DB rows
- [ ] Upsert pipeline: Trade, Subject, Holding tables
- [ ] All API endpoints (`/subjects`, `/subjects/[address]`, `/portfolio/[wallet]`, `/activity`)
- [ ] Test with devnet trades

### Week 4 — Pages
- [ ] Discovery page (`/`) — trending feed with SubjectCard grid
- [ ] Profile page — PriceChart (recharts), HoldersList, activity feed
- [ ] Portfolio page — holdings table, total value
- [ ] Activity page — global feed

### Week 5 — Auth + Chat
- [ ] Nonce/verify auth flow
- [ ] JWT middleware protecting `/portfolio`
- [ ] XMTP chat panel on profile page
- [ ] Balance-gated chat access

### Week 6 — Polish + Mainnet
- [ ] Mobile responsive pass
- [ ] Loading skeletons everywhere
- [ ] Error boundaries + toast notifications
- [ ] Optimistic UI on trades
- [ ] Mainnet deploy (Vercel + Supabase prod)
- [ ] Point Helius webhook to prod URL
- [ ] Smoke test with real SOL

---

## Phase 10: Known Gotchas

### Rent on first buy
Every new `BalanceState` PDA costs ~0.002 SOL rent. The first buyer of a creator's shares pays this silently. Make it visible in the trade widget:
```
"Note: First purchase creates an on-chain account (~0.002 SOL rent, refundable)"
```

### Supply read latency
After a trade confirms, the Helius webhook arrives ~1–3 seconds later. The supply shown in the widget may lag. Fix with optimistic updates:
```typescript
// After tx confirms, increment local supply immediately
// Revalidate from chain or DB after 3 seconds
```

### PDA derivation in client
You must derive PDAs in the frontend to pass as accounts to Anchor instructions:
```typescript
const [subjectStatePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("subject"), subjectPubkey.toBuffer()],
  PROGRAM_ID
);
const [balanceStatePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("balance"), subjectPubkey.toBuffer(), buyerPubkey.toBuffer()],
  PROGRAM_ID
);
```

### BigInt in JSON
Prisma returns `BigInt` for `supply`, `balance`, etc. JSON.stringify doesn't handle BigInt natively:
```typescript
// In API routes, serialize BigInt before returning
JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v)
```

### RPC rate limits
Free Solana RPC limits will bite you fast. Use Helius (free tier: 100k credits/day) or QuickNode from day one. Never use `api.mainnet-beta.solana.com` in production.

---

## Phase 11: Scaling Later (Post-Launch)

Once you have users, these become relevant:

- **Redis cache** — cache supply + current price per subject, invalidate on new trade event
- **WebSocket feed** — real-time trade activity via Supabase Realtime or Ably
- **Social graph** — link Twitter/X handles to wallet addresses (SNS, Solana Name Service)
- **Notification system** — alert holders when their creator trades
- **Mobile app** — React Native with same wallet adapter, same API
- **Analytics dashboard** — for creators to see their holder stats
- **Token-gated content** — beyond chat: posts, files, livestreams

---

## Summary

```
Contract (Anchor)  →  Emits TradeEvent
        ↓
Helius Webhook     →  POST /api/events
        ↓
Prisma + Postgres  →  Trade, Subject, Holding tables
        ↓
API Routes         →  Subjects, Portfolio, Activity
        ↓
Next.js Frontend   →  Discovery, Profile, Portfolio pages
        ↓
TradeWidget        →  Builds Anchor tx → User signs → On-chain
```

The loop is complete. Every trade updates the chain, the indexer catches it within seconds, the DB reflects the new state, and the UI shows live prices.
