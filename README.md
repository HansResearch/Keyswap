# Keyswap

**On-chain tradable units on Solana. Anyone can launch one for anything.**

Keyswap is a fully open-source, on-chain key trading protocol built on Solana. Keys are backed by real SPL tokens — not just numbers in a database. Launch a key for a meme, a cause, a community, a project, or any idea worth rallying people around.

**Live at [keyswap.fun](https://keyswap.fun) · Program ID: [`983hyfdeswchDLV8epdLGHBCDwTVrkg8BGdxZv5pgMCf`](https://solscan.io/account/983hyfdeswchDLV8epdLGHBCDwTVrkg8BGdxZv5pgMCf)**

---

## What is a key?

A key is an on-chain tradable unit. It isn't tied to a person, a creator, or any particular thing — anyone can launch one for any reason.

| Type | Examples |
|---|---|
| 🎭 Memes | Fun, viral, community-driven |
| ❤️ Causes | Charity, fundraisers, awareness |
| 🌍 Movements | Cultural, environmental, political |
| 🎨 Culture | A trend, an event, a vibe, a niche |
| 🏗️ Projects | Open source, art, music, hobbies |
| 👥 Communities | Local, online, fandoms, scenes |
| 💡 Ideas | Anything worth rallying people around |

> The protocol doesn't care what the key is "about." If you can name it, you can launch it.

---

## Under the hood — real SPL tokens

Every key has its own **dedicated SPL token mint** — the same token standard as USDC, BONK, or any other Solana token. Holding "5 keys of `tokyo`" means you literally hold 5 units of the `tokyo` SPL token in your wallet.

- **Launching** creates a new SPL mint — one mint per key, dedicated to just that key.
- **Buying** mints SPL tokens — when you buy 5 keys, the contract mints 5 fresh tokens straight into your wallet.
- **Selling** burns SPL tokens — when you sell 2 keys back, the contract burns 2 of your tokens and pays you the corresponding SOL from the on-chain escrow.
- **Transferring** works like any SPL token — open Phantom, Solflare, or any Solana wallet and transfer peer-to-peer. The contract isn't involved.

> Your keys aren't trapped in our app. They're standard Solana tokens that show up in any wallet, work with any tool, and are truly yours.

---

## Bonding curve — prices rise with every buy

Every new buyer pays a little more than the last. Early supporters get the best price. As more people buy in, the price climbs. As people sell back, the price comes back down. It's a self-balancing market — no order book, no manual price-setting, just supply and demand on a math curve.

| Keys in circulation | Next-key price |
|---|---|
| 0 — just launched | 0.01 SOL |
| 10 | 0.11 SOL |
| 50 | 0.51 SOL |
| 100 | 1.02 SOL |
| 500 | 5.27 SOL |
| 1,000 | 11.12 SOL |

Same formula for every key on the platform. Totally different prices — driven entirely by demand.

---

## Launching a key

1. Pick a name (lowercase letters and digits, 3–32 characters).
2. Buy your first 3–50 keys to seed the launch — you have to be the first supporter.
3. Minimum launch cost: **~0.06 SOL** (~$5).
4. Your key is live. A new SPL mint is created. Anyone can buy in. The link is shareable.

**Example:** A community organizer launches `relief2024` for a disaster fund. She buys 3 keys to seed it (~$5). The launch transaction creates a brand-new `relief2024` SPL mint, and 3 of those tokens land in her wallet. As people buy in to support the cause, 1% of every trade flows back to her payout wallet.

---

## Buying

Pick a key, choose how many, click Buy.

- The price moves with each buy. **Early in = cheaper.**
- You can buy multiple at once — cheaper per-key than spreading across many transactions.
- Once bought, the SPL tokens are in your wallet to hold, sell, or transfer.

---

## Selling

You can sell anytime. The contract always has the liquidity to pay you out — it's locked in an on-chain escrow, separate from any wallet.

- The contract **burns your tokens** and sends you the equivalent SOL.
- **Small sells return ~95%** of the curve price.
- Bigger chunks have a touch more spread — keeps the market healthy for everyone.
- **MAX button** sells everything you can in one click.

**Example:** You bought 5 keys for 0.55 SOL when the key was fresh. Later you sell them back. The contract burns those 5 tokens from your wallet and credits ~0.52 SOL — the small spread keeps the market healthy, not a fee.

---

## Transferring (peer-to-peer)

Since keys are real SPL tokens, you can send them to anyone:

- Use **any Solana wallet** — Phantom, Solflare, Backpack — they'll show your keys like any other token.
- **No protocol fee** for plain transfers — you just pay the tiny Solana network fee.
- The recipient gets **full ownership** — they can hold, sell, or transfer onward.

Useful for gifting, splitting between wallets, sending to a multi-sig, or any peer-to-peer move.

---

## Fees

Every buy or sell has a flat **3% fee**, split two ways:

| Recipient | Cut | Purpose |
|---|---|---|
| Protocol | 2% | Funds development, infra, and the on-chain contract |
| Launcher's payout wallet | 1% | Routed wherever the launcher chooses |

No hidden costs, no withdrawal fees, no surprises. **Plain SPL transfers pay no protocol fee** — only buys and sells go through the bonding-curve contract.

The launcher's 1% is a sustainable, automatic funding stream:

| Key type | What the 1% becomes |
|---|---|
| Charity key | Ongoing donations as the key gets traded |
| Meme key | A community treasury |
| Project key | An income stream for the work |
| Art / music key | Functions like a royalty |

> The launcher can route the payout to any wallet — including a multi-sig, a DAO, or a different person.

---

## Full walkthrough

Someone launches a key called `oceancleanup` for an environmental fundraiser:

1. **Launch:** They buy 3 keys to seed it. The contract creates the `oceancleanup` SPL mint and mints 3 tokens into their wallet. Total cost: ~0.06 SOL.
2. **Supporters buy in:** Friends and fans buy keys. Each buy mints fresh `oceancleanup` tokens into their wallets. 1% of every trade flows to the launcher's payout wallet.
3. **Momentum grows:** Supply grows, price climbs. Earlier supporters now hold something worth more than what they paid.
4. **A supporter gifts some:** One supporter opens Phantom and transfers 2 `oceancleanup` tokens to a friend — no protocol involvement, no fee beyond the Solana network fee.
5. **Anyone can exit:** Any holder can sell anytime at the current curve price. The contract burns the tokens and pays out SOL. Liquidity is guaranteed by the contract's escrow.
6. **The cause keeps earning:** Even after early holders cash out, every new trade still funnels 1% to the payout wallet.

---

## TL;DR

- ✓ **Keys** = on-chain tradable units, backed by real SPL tokens in your wallet.
- ✓ **One SPL mint per key** — yours to hold, sell, or transfer peer-to-peer.
- ✓ **Anyone can launch one for anything** — a meme, a cause, a movement, a project, a community, an idea.
- ✓ **Buying mints tokens · selling burns tokens · transfers work in any Solana wallet.**
- ✓ **Prices rise with demand** — early in = cheaper.
- ✓ **3% fee per buy/sell** — 2% to the protocol, 1% to the launcher's payout wallet. Plain transfers are free.
- ✓ **Everything on-chain.** No custodian. Your keys live in your wallet.

---

## Repo structure

```
keyswap/
├── friendtech-final/        # Deployed Solana program (Anchor 0.29, sqrt bonding curve)
├── friendtech-shares/       # Anchor workspace — earlier dev version
├── backend/                 # Hono API + SQLite indexer (TypeScript, Railway deploy)
├── frontend/                # Original React SPA (Vite, Solana wallet adapter)
├── lovable-frontend/        # Production frontend (React 19, TanStack Router, shadcn/ui)
├── init-protocol.mjs        # Deploy & initialize the on-chain protocol config
├── propose-fee-destination.mjs  # Propose a new protocol fee destination (timelocked)
└── apply-fee-destination.mjs    # Apply after timelock elapses
```

## Running locally

```bash
# Install dependencies
npm install
npm install --prefix backend
npm install --prefix lovable-frontend

# Copy env templates and fill in your values
cp .env.example .env
cp backend/.env.example backend/.env
cp lovable-frontend/.env.example lovable-frontend/.env.local

# Start backend + frontend together
npm run dev
```

The backend runs on `http://localhost:3001` and the frontend on `http://localhost:5174`.

You'll need a [Helius](https://helius.dev) RPC URL and the program ID set in your `.env` files.

---

## License

MIT
