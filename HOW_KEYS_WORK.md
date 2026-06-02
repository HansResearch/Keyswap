# How Keys Work

A quick, jargon-free guide to launching, buying, selling, and transferring keys.

---

## What is a key?

A **key** is an on-chain tradable unit on Solana. It isn't tied to a person, a creator, or any particular thing. **Anyone can launch a key for any reason.**

A few examples of what people launch keys for:

- 🎭 **Memes** — fun, viral, community-driven
- ❤️ **Causes** — charity, fundraisers, awareness
- 🌍 **Movements** — cultural, environmental, political
- 🎨 **Culture moments** — a trend, an event, a vibe, a niche
- 🏗️ **Projects** — open source, art, music, hobbies
- 👥 **Communities** — local, online, fandoms, scenes
- 💡 **Ideas** — anything worth rallying people around

The protocol doesn't care what the key is "about." If you can name it, you can launch it.

---

## Under the hood — keys are backed by SPL tokens

This is the part that makes keys real on-chain assets, not just numbers in a database.

Every key on the platform has its own **dedicated SPL token mint** — the same token standard as USDC, BONK, or any other Solana token. Holding "5 keys of `tokyo`" means you literally hold 5 units of the `tokyo` SPL token in your wallet.

The mechanics:

- 🪙 **Launching a new key creates a new SPL mint** — one mint per key, dedicated to just that key.
- 🟢 **Buying mints SPL tokens.** When you buy 5 keys, the contract mints 5 fresh tokens straight into your wallet.
- 🔴 **Selling burns SPL tokens.** When you sell 2 keys back, the contract burns 2 of your tokens and pays you the corresponding SOL from the contract's escrow.
- 🔄 **Transferring works like any SPL token.** Want to send 3 keys to a friend? Open Phantom, Solflare, or any Solana wallet, and transfer them like you would BONK or USDC. The contract isn't involved — it's a plain SPL transfer. Your friend can then hold them, sell them, or transfer them onward.

That means your keys aren't trapped in our app. They're **standard Solana tokens** that show up in any wallet, work with any tool, and are truly yours.

---

## Prices rise with every buy

This is the **bonding curve** in one sentence:
**every new buyer pays a little more than the last.**

Early supporters get the best price. As more people buy in, the price climbs. As people sell back, the price comes back down. It's a self-balancing market — no order book, no manual price-setting, just supply and demand on a math curve.

Here's what the price looks like for buying the *next* key:

| Total keys out | Price for the next key |
|:--:|:--:|
| 0 (just launched) | **0.01 SOL** |
| 10 | 0.11 SOL |
| 50 | 0.51 SOL |
| 100 | 1.02 SOL |
| 500 | 5.27 SOL |
| 1,000 | 11.12 SOL |

Same formula for every key on the platform. Totally different prices, driven entirely by demand.

---

## Launching a key

1. **Pick a name** (lowercase letters and digits, 3–32 characters)
2. **Buy your first 3–50 keys** to seed the launch — you have to be the first supporter
3. **Minimum launch cost: ~0.06 SOL** (around $5)
4. Your key is live. A new SPL mint is created. Anyone can buy in. The link is shareable.

**Example:** A community organizer launches `relief2024` for a disaster fund. She buys 3 keys to seed it (~$5). The launch transaction creates a brand-new `relief2024` SPL mint, and 3 of those tokens land in her wallet. She shares the link. As people buy in to support the cause, the contract mints more `relief2024` tokens to each buyer's wallet, and 1% of every trade flows back to her payout wallet — which she's set up to forward to the cause.

---

## Buying keys

Pick a key, choose how many, click Buy. Two things to know:

1. **The price moves with each buy.** Early in = cheaper.
2. **You can buy multiple at once** — cheaper per-key than spreading across many transactions.

Once you've bought, the SPL tokens are in your wallet. You can do anything you'd do with any other Solana token — including transferring them peer-to-peer.

---

## Selling

You can sell anytime. The contract always has the liquidity to pay you out — it's locked in an on-chain escrow, separate from any wallet.

- **The contract burns your tokens** and sends you the equivalent SOL
- **Small sells return ~95%** of the curve price
- **Bigger chunks have a touch more spread** — keeps the market healthy for everyone
- **MAX button** sells everything you can in one click

**Example:** You bought 5 keys for 0.55 SOL when the key was fresh. A bit later you sell them back. The contract burns those 5 tokens from your wallet and credits ~0.52 SOL to you — the small spread is what keeps the market healthy, not a fee.

---

## Transferring (peer-to-peer)

Since keys are real SPL tokens, you can send them to anyone:

- **Use any Solana wallet** — Phantom, Solflare, Backpack — they'll show your keys just like any other token
- **No fees from the protocol** for plain transfers (you just pay the tiny Solana network fee)
- **The recipient gets full ownership** — they can hold, sell, or transfer onward
- **The contract doesn't track who holds what** — it just sees the total supply. The SPL Token Program tracks individual balances on-chain.

Useful for gifting, splitting between wallets, sending to a multi-sig, or any peer-to-peer move.

---

## Fees, plain and simple

Every buy or sell has a flat **3% fee**, split:

| Goes to | Amount |
|---|:--:|
| The protocol | 2% |
| The launcher's payout wallet | 1% |

That's it. No hidden costs, no withdrawal fees, no surprises. **Plain SPL transfers between wallets pay no protocol fee** — only buys and sells go through the bonding-curve contract.

The launcher's 1% is meant to be a sustainable, automatic funding stream:
- For a **charity key**, it's ongoing donations as the key gets traded
- For a **meme key**, it's a community treasury
- For a **project key**, it's an income stream for the work
- For an **art / music key**, it's like a royalty
- The launcher can route the payout to **any wallet they want** — including a multi-sig, a DAO, or a different person.

---

## A full walkthrough

Let's say someone launches a key called `oceancleanup` for an environmental fundraiser:

1. **Launch:** They buy 3 keys to seed it. The contract creates the `oceancleanup` SPL mint and mints 3 of those tokens into their wallet. Total cost: ~0.06 SOL.
2. **Supporters buy in:** Friends and fans buy keys. Each buy mints fresh `oceancleanup` tokens into their wallets. 1% of every trade flows to the launcher's payout wallet.
3. **Momentum grows:** Supply grows, price climbs. Earlier supporters now hold something worth more than what they paid.
4. **A supporter gifts some:** One supporter wants to give 2 keys to a friend. She opens Phantom and transfers 2 `oceancleanup` tokens — no protocol involvement, no fee beyond the Solana network fee. Her friend now holds them in his wallet.
5. **Anyone can exit:** Any holder can sell anytime at the current curve price. The contract burns the tokens and pays out SOL. Liquidity is guaranteed by the contract's escrow.
6. **The cause keeps earning:** Even after early holders cash out, every new trade still funnels 1% to the payout wallet. As long as the key gets traded, the cause keeps getting funded.

The exact same mechanics work for a meme, a community, an art project, a movement — anything. The "what it's for" is entirely up to whoever launches.

---

## TL;DR

- **Keys** = on-chain tradable units, **backed by real SPL tokens** in your wallet
- **One SPL mint per key** — yours to hold, sell, or transfer peer-to-peer
- **Anyone can launch one for anything** — a meme, a cause, a movement, a project, a community, an idea
- **Buying mints tokens · selling burns tokens · transfers work in any Solana wallet**
- **Prices rise with demand** (early in = cheaper)
- **3% fee per buy/sell** — 2% to the protocol, 1% to the launcher's payout wallet. **Plain transfers are free.**
- **Everything on-chain.** No custodian. Your keys live in your wallet.

Have fun out there.
