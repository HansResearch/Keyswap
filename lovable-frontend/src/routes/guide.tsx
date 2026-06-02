import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/guide")({
  component: GuidePage,
});

type Tone = "primary" | "success" | "destructive" | "muted";

// Single source of truth for the sidebar TOC + the IntersectionObserver targets.
// Section ids match the anchor hashes (e.g. `#bonding-curve`).
const SECTIONS = [
  { id: "what-is-a-key", label: "What is a key?" },
  { id: "spl-tokens", label: "SPL tokens" },
  { id: "bonding-curve", label: "Bonding curve" },
  { id: "launching", label: "Launching" },
  { id: "buying", label: "Buying" },
  { id: "selling", label: "Selling" },
  { id: "transferring", label: "Transferring" },
  { id: "fees", label: "Fees" },
  { id: "walkthrough", label: "Walkthrough" },
  { id: "tldr", label: "TL;DR" },
];

function GuidePage() {
  const [active, setActive] = useState(SECTIONS[0].id);

  // Highlight the current TOC item as the user scrolls. We watch a thin band
  // ~20-30% from the top of the viewport so the active link tracks the section
  // the reader's eye is most likely on (not the one they just left).
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        {/* Page header */}
        <div className="mb-8 border-b border-border pb-6 sm:mb-10 sm:pb-8">
          <p className="font-mono text-mono-xs uppercase tracking-[0.25em] text-primary">Guide</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">How Keys Work</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            A quick, jargon-free guide to launching, buying, selling, and transferring keys —
            the on-chain tradable units that anyone can create for anything.
          </p>
        </div>

        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Sticky sidebar TOC */}
          <nav className="hidden lg:block">
            <div className="sticky top-28">
              <p className="mb-3 font-mono text-mono-xs uppercase tracking-[0.2em] text-muted-foreground">
                Contents
              </p>
              <ul className="list-none border-l border-border">
                {SECTIONS.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`-ml-px flex items-center gap-2 border-l-2 px-3 py-1.5 text-mono-xs transition ${
                        active === s.id
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      <span className="font-mono tabular-nums opacity-50">
                        {(i + 1).toString().padStart(2, "0")}
                      </span>
                      <span>{s.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Article */}
          <article className="max-w-3xl space-y-16">
            <Section id="what-is-a-key" number="01" title="What is a key?">
              <p className="text-sm leading-relaxed text-foreground/90">
                A <strong className="text-foreground">key</strong> is an on-chain tradable unit on Solana.
                It isn't tied to a person, a creator, or any particular thing.{" "}
                <strong className="text-foreground">Anyone can launch a key for any reason.</strong>
              </p>

              <p className="text-sm leading-relaxed text-muted-foreground">
                A few examples of what people launch keys for:
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <Category emoji="🎭" label="Memes" desc="Fun, viral, community-driven" />
                <Category emoji="❤️" label="Causes" desc="Charity, fundraisers, awareness" />
                <Category emoji="🌍" label="Movements" desc="Cultural, environmental, political" />
                <Category emoji="🎨" label="Culture" desc="A trend, an event, a vibe, a niche" />
                <Category emoji="🏗️" label="Projects" desc="Open source, art, music, hobbies" />
                <Category emoji="👥" label="Communities" desc="Local, online, fandoms, scenes" />
                <Category emoji="💡" label="Ideas" desc="Anything worth rallying people around" />
              </div>

              <Callout>
                The protocol doesn't care what the key is "about." If you can name it, you can launch it.
              </Callout>
            </Section>

            <Section id="spl-tokens" number="02" title="Under the hood — real SPL tokens">
              <p className="text-sm leading-relaxed text-foreground/90">
                This is the part that makes keys real on-chain assets — not just numbers in a database.
              </p>

              <p className="text-sm leading-relaxed text-muted-foreground">
                Every key has its own <strong className="text-foreground">dedicated SPL token mint</strong> —
                the same token standard as USDC, BONK, or any other Solana token. Holding "5 keys of{" "}
                <Code>tokyo</Code>" means you literally hold 5 units of the <Code>tokyo</Code> SPL token in your wallet.
              </p>

              <div className="grid gap-3">
                <Mechanic tone="primary" glyph="✦" title="Launching">
                  Creates a new SPL mint — one mint per key, dedicated to just that key.
                </Mechanic>
                <Mechanic tone="success" glyph="+" title="Buying mints SPL tokens">
                  When you buy 5 keys, the contract mints 5 fresh tokens straight into your wallet.
                </Mechanic>
                <Mechanic tone="destructive" glyph="−" title="Selling burns SPL tokens">
                  When you sell 2 keys back, the contract burns 2 of your tokens and pays you the corresponding SOL from the on-chain escrow.
                </Mechanic>
                <Mechanic tone="muted" glyph="→" title="Transferring works like any SPL token">
                  Open Phantom, Solflare, or any Solana wallet, and transfer them peer-to-peer. The contract isn't involved — it's a plain SPL transfer.
                </Mechanic>
              </div>

              <Callout tone="success">
                Your keys aren't trapped in our app. They're standard Solana tokens that show up in any wallet, work with any tool, and are truly yours.
              </Callout>
            </Section>

            <Section id="bonding-curve" number="03" title="Prices rise with every buy">
              <p className="text-sm leading-relaxed text-foreground/90">
                This is the <strong className="text-foreground">bonding curve</strong> in one sentence:{" "}
                <em>every new buyer pays a little more than the last.</em>
              </p>

              <p className="text-sm leading-relaxed text-muted-foreground">
                Early supporters get the best price. As more people buy in, the price climbs.
                As people sell back, the price comes back down. It's a self-balancing market —
                no order book, no manual price-setting, just supply and demand on a math curve.
              </p>

              <div>
                <p className="mb-2 font-mono text-mono-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Price for the next key, by current supply
                </p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-surface text-mono-xs text-muted-foreground">
                        <th className="px-4 py-3 text-left font-normal">Keys out</th>
                        <th className="px-4 py-3 text-right font-normal">Next-key price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["0 — just launched", "0.01 SOL"],
                        ["10", "0.11 SOL"],
                        ["50", "0.51 SOL"],
                        ["100", "1.02 SOL"],
                        ["500", "5.27 SOL"],
                        ["1,000", "11.12 SOL"],
                      ].map(([supply, price]) => (
                        <tr key={supply} className="border-b border-border/50 last:border-0">
                          <td className="px-4 py-2.5 text-sm text-muted-foreground">{supply}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums">{price}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <Callout>
                Same formula for every key on the platform. Totally different prices — driven entirely by demand.
              </Callout>
            </Section>

            <Section id="launching" number="04" title="Launching a key">
              <ol className="list-none space-y-3">
                <Step n="1">Pick a name (lowercase letters and digits, 3–32 characters).</Step>
                <Step n="2">Buy your first 3–50 keys to seed the launch — you have to be the first supporter.</Step>
                <Step n="3">Minimum launch cost: <strong className="text-foreground">~0.06 SOL</strong> (around $5).</Step>
                <Step n="4">Your key is live. A new SPL mint is created. Anyone can buy in. The link is shareable.</Step>
              </ol>

              <Example title="Real-world example">
                A community organizer launches <Code>relief2024</Code> for a disaster fund.
                She buys 3 keys to seed it (~$5). The launch transaction creates a brand-new{" "}
                <Code>relief2024</Code> SPL mint, and 3 of those tokens land in her wallet.
                She shares the link. As people buy in to support the cause, the contract mints
                more <Code>relief2024</Code> tokens to each buyer's wallet — and 1% of every
                trade flows back to her payout wallet, which she's set up to forward to the cause.
              </Example>
            </Section>

            <Section id="buying" number="05" title="Buying keys">
              <p className="text-sm leading-relaxed text-foreground/90">
                Pick a key, choose how many, click Buy. Two things to know:
              </p>
              <ol className="list-none space-y-3">
                <Step n="1">The price moves with each buy. <strong className="text-foreground">Early in = cheaper.</strong></Step>
                <Step n="2">You can buy multiple at once — cheaper per-key than spreading across many transactions.</Step>
              </ol>

              <Callout>
                Once you've bought, the SPL tokens are in your wallet. You can do anything you'd do with any other Solana token — including transferring them peer-to-peer.
              </Callout>
            </Section>

            <Section id="selling" number="06" title="Selling">
              <p className="text-sm leading-relaxed text-foreground/90">
                You can sell anytime. The contract always has the liquidity to pay you out — it's
                locked in an on-chain escrow, separate from any wallet.
              </p>

              <ul className="list-none space-y-2">
                <Bullet>The contract <strong className="text-foreground">burns your tokens</strong> and sends you the equivalent SOL.</Bullet>
                <Bullet><strong className="text-foreground">Small sells return ~95%</strong> of the curve price.</Bullet>
                <Bullet>Bigger chunks have a touch more spread — keeps the market healthy for everyone.</Bullet>
                <Bullet><strong className="text-foreground">MAX button</strong> sells everything you can in one click.</Bullet>
              </ul>

              <Example title="Real-world example">
                You bought 5 keys for 0.55 SOL when the key was fresh. A bit later you sell them
                back. The contract burns those 5 tokens from your wallet and credits ~0.52 SOL to
                you — the small spread is what keeps the market healthy, not a fee.
              </Example>
            </Section>

            <Section id="transferring" number="07" title="Transferring (peer-to-peer)">
              <p className="text-sm leading-relaxed text-foreground/90">
                Since keys are real SPL tokens, you can send them to anyone:
              </p>

              <ul className="list-none space-y-2">
                <Bullet>Use <strong className="text-foreground">any Solana wallet</strong> — Phantom, Solflare, Backpack — they'll show your keys just like any other token.</Bullet>
                <Bullet><strong className="text-foreground">No fees from the protocol</strong> for plain transfers — you just pay the tiny Solana network fee.</Bullet>
                <Bullet>The recipient gets <strong className="text-foreground">full ownership</strong> — they can hold, sell, or transfer onward.</Bullet>
                <Bullet>The contract doesn't track who holds what — it just sees the total supply. The SPL Token Program tracks individual balances on-chain.</Bullet>
              </ul>

              <Callout>
                Useful for gifting, splitting between wallets, sending to a multi-sig, or any peer-to-peer move.
              </Callout>
            </Section>

            <Section id="fees" number="08" title="Fees, plain and simple">
              <p className="text-sm leading-relaxed text-foreground/90">
                Every buy or sell has a flat <strong className="text-foreground">3% fee</strong>, split two ways:
              </p>

              <div className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center justify-between gap-4 px-4 py-4">
                  <div>
                    <div className="text-sm font-semibold">The protocol</div>
                    <div className="mt-0.5 text-mono-xs text-muted-foreground">Funds development, infra, and the on-chain contract</div>
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-primary">2%</div>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-4">
                  <div>
                    <div className="text-sm font-semibold">Launcher's payout wallet</div>
                    <div className="mt-0.5 text-mono-xs text-muted-foreground">Routed wherever the launcher chooses</div>
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-success">1%</div>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground">
                That's it. No hidden costs, no withdrawal fees, no surprises.{" "}
                <strong className="text-foreground">Plain SPL transfers between wallets pay no protocol fee</strong> —
                only buys and sells go through the bonding-curve contract.
              </p>

              <p className="text-sm leading-relaxed text-muted-foreground">
                The launcher's 1% is meant to be a sustainable, automatic funding stream:
              </p>

              <div className="grid gap-2 sm:grid-cols-2">
                <UseCase label="Charity key" text="Ongoing donations as the key gets traded" />
                <UseCase label="Meme key" text="A community treasury" />
                <UseCase label="Project key" text="An income stream for the work" />
                <UseCase label="Art / music key" text="Functions like a royalty" />
              </div>

              <Callout tone="success">
                The launcher can route the payout to any wallet — including a multi-sig, a DAO, or a different person.
              </Callout>
            </Section>

            <Section id="walkthrough" number="09" title="A full walkthrough">
              <p className="text-sm leading-relaxed text-foreground/90">
                Let's say someone launches a key called <Code>oceancleanup</Code> for an environmental fundraiser:
              </p>

              <ol className="list-none space-y-3">
                <Step n="1">
                  <strong className="text-foreground">Launch:</strong> They buy 3 keys to seed it.
                  The contract creates the <Code>oceancleanup</Code> SPL mint and mints 3 of those tokens into their wallet.
                  Total cost: ~0.06 SOL.
                </Step>
                <Step n="2">
                  <strong className="text-foreground">Supporters buy in:</strong> Friends and fans buy keys.
                  Each buy mints fresh <Code>oceancleanup</Code> tokens into their wallets. 1% of every trade flows to the launcher's payout wallet.
                </Step>
                <Step n="3">
                  <strong className="text-foreground">Momentum grows:</strong> Supply grows, price climbs.
                  Earlier supporters now hold something worth more than what they paid.
                </Step>
                <Step n="4">
                  <strong className="text-foreground">A supporter gifts some:</strong> One supporter wants to give 2 keys to a friend.
                  She opens Phantom and transfers 2 <Code>oceancleanup</Code> tokens — no protocol involvement, no fee beyond the Solana network fee.
                </Step>
                <Step n="5">
                  <strong className="text-foreground">Anyone can exit:</strong> Any holder can sell anytime at the current curve price.
                  The contract burns the tokens and pays out SOL. Liquidity is guaranteed by the contract's escrow.
                </Step>
                <Step n="6">
                  <strong className="text-foreground">The cause keeps earning:</strong> Even after early holders cash out, every new trade still funnels 1% to the payout wallet.
                </Step>
              </ol>

              <Callout>
                The exact same mechanics work for a meme, a community, an art project, a movement — anything. The "what it's for" is entirely up to whoever launches.
              </Callout>
            </Section>

            <Section id="tldr" number="10" title="TL;DR">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
                <ul className="list-none space-y-3">
                  <TldrItem><strong className="text-foreground">Keys</strong> = on-chain tradable units, backed by real SPL tokens in your wallet.</TldrItem>
                  <TldrItem><strong className="text-foreground">One SPL mint per key</strong> — yours to hold, sell, or transfer peer-to-peer.</TldrItem>
                  <TldrItem><strong className="text-foreground">Anyone can launch one for anything</strong> — a meme, a cause, a movement, a project, a community, an idea.</TldrItem>
                  <TldrItem><strong className="text-foreground">Buying mints tokens · selling burns tokens · transfers work in any Solana wallet.</strong></TldrItem>
                  <TldrItem><strong className="text-foreground">Prices rise with demand</strong> — early in = cheaper.</TldrItem>
                  <TldrItem><strong className="text-foreground">3% fee per buy/sell</strong> — 2% to the protocol, 1% to the launcher's payout wallet. Plain transfers are free.</TldrItem>
                  <TldrItem><strong className="text-foreground">Everything on-chain.</strong> No custodian. Your keys live in your wallet.</TldrItem>
                </ul>
              </div>

              <p className="pt-2 text-center font-mono text-mono-xs uppercase tracking-[0.3em] text-muted-foreground">
                Have fun out there
              </p>
            </Section>
          </article>
        </div>
      </div>
    </main>
  );
}

// ─── subcomponents ────────────────────────────────────────────────────────────

function Section({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <header className="mb-5 flex items-baseline gap-3 border-b border-border/60 pb-3">
        <span className="font-mono text-mono-xs font-bold tracking-[0.25em] text-primary">{number}</span>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Category({ emoji, label, desc }: { emoji: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3 transition hover:border-primary/40">
      <span className="text-lg leading-none">{emoji}</span>
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-mono-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

function Mechanic({
  tone,
  glyph,
  title,
  children,
}: {
  tone: Tone;
  glyph: string;
  title: string;
  children: React.ReactNode;
}) {
  // Tailwind needs literal class strings in source for the JIT, so we map
  // tone -> classes explicitly rather than interpolating.
  const colorMap: Record<Tone, string> = {
    primary: "border-primary/40 bg-primary/10 text-primary",
    success: "border-success/40 bg-success/10 text-success",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
    muted: "border-border bg-background text-muted-foreground",
  };
  return (
    <div className="flex gap-4 rounded-lg border border-border bg-surface p-4 transition hover:border-primary/30">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-base font-bold ${colorMap[tone]}`}>
        {glyph}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-mono-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function Callout({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" }) {
  const toneClasses =
    tone === "success"
      ? "border-l-success bg-success/5"
      : "border-l-primary bg-primary/5";
  return (
    <div className={`rounded-md border border-border border-l-2 ${toneClasses} px-4 py-3`}>
      <p className="text-sm italic leading-relaxed text-foreground/85">{children}</p>
    </div>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-mono-xs font-bold text-primary">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function Example({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      {title && (
        <div className="mb-2 font-mono text-mono-xs font-bold uppercase tracking-[0.2em] text-primary">
          {title}
        </div>
      )}
      <p className="text-sm leading-relaxed text-foreground/85">{children}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
      <span>{children}</span>
    </li>
  );
}

function UseCase({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="font-mono text-mono-xs font-bold uppercase tracking-wider text-primary">{label}</div>
      <div className="mt-1 text-mono-xs text-muted-foreground">{text}</div>
    </div>
  );
}

function TldrItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
      <span className="text-primary">✓</span>
      <span>{children}</span>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-mono-xs text-primary">
      {children}
    </code>
  );
}
