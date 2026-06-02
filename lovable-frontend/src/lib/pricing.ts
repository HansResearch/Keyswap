// Must match friendtech-final/src/pricing.rs exactly
//
// Hyperbolic bonding curve: price(s) = K * (s + 1) / (MAX_SUPPLY - s)
// K = 100 SOL (100_000_000_000 lamports)
// MAX_SUPPLY = 10,000 keys hard cap per name

const MAX_SUPPLY = 10_000n
const K          = 100_000_000_000n  // 100 SOL in lamports

// Virtual supply added to real supply for MC display only (not in price formula).
// Makes even a 3-key launch show ~$1K MC.
const V_DISPLAY = 175n

// Sell slippage constants — must match pricing.rs
const SELL_RATIO_BASE:  bigint = 9_500n
const SELL_RATIO_FLOOR: bigint = 8_000n
const SELL_SLOPE:       bigint = 50n

function pricePerKey(supply: bigint): bigint {
  if (supply >= MAX_SUPPLY) return 0n
  return K * (supply + 1n) / (MAX_SUPPLY - supply)
}

export function getBuyPrice(supply: number, amount: number): number {
  if (amount <= 0) return 0
  const s = BigInt(supply)
  const a = BigInt(amount)
  if (s + a > MAX_SUPPLY) return 0
  const pStart = pricePerKey(s)
  const pEnd   = pricePerKey(s + a - 1n)
  return Number((pStart + pEnd) / 2n * a)
}

function getSellRatioBps(supply: number, amount: number): bigint {
  if (supply === 0) return SELL_RATIO_FLOOR
  const sellBps = BigInt(amount) * 10_000n / BigInt(supply)
  const penalty = sellBps * SELL_SLOPE / 100n
  const ratio   = SELL_RATIO_BASE > penalty ? SELL_RATIO_BASE - penalty : 0n
  return ratio < SELL_RATIO_FLOOR ? SELL_RATIO_FLOOR : ratio
}

export function getSellPrice(supply: number, amount: number): number {
  if (supply <= amount) return 0
  const raw   = getBuyPrice(supply - amount, amount)
  const ratio = getSellRatioBps(supply, amount)
  return Number(BigInt(raw) * ratio / 10_000n)
}

export function getSellSlippage(supply: number, amount: number): number {
  const ratio = Number(getSellRatioBps(supply, amount))
  return (10_000 - ratio) / 100
}

// MC = current price × (supply + V_DISPLAY)
// V_DISPLAY offset makes a fresh 3-key launch show ~$1K MC rather than $18
export function getMarketCap(supply: number): number {
  if (supply === 0) return 0
  const s = BigInt(supply)
  return Number(pricePerKey(s) * (s + V_DISPLAY))
}

export function fmtSol(lamports: number): string {
  const sol = lamports / 1e9
  if (sol === 0) return '0'
  if (sol < 0.001) return '<0.001'
  return sol.toFixed(3)
}

export function fmtUsd(lamports: number, solPriceUsd: number): string {
  if (solPriceUsd <= 0) return ''
  const usd = (lamports / 1e9) * solPriceUsd
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
  if (usd >= 1) return `$${usd.toFixed(0)}`
  return `$${usd.toFixed(2)}`
}
