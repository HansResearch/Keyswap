const BASE = 1_000_000n
const SCALE = 60_000n

function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n
  let x = n
  let y = (x + 1n) >> 1n
  while (y < x) {
    x = y
    y = (x + n / x) >> 1n
  }
  return x
}

function pricePerKey(supply: bigint): bigint {
  return SCALE * isqrt(supply + 1n) + BASE
}

export function getBuyPrice(supply: number, amount: number): number {
  const s = BigInt(supply)
  const a = BigInt(amount)
  const pStart = pricePerKey(s)
  const pEnd = pricePerKey(s + a - 1n)
  return Number(((pStart + pEnd) / 2n) * a)
}

export function getSellPrice(supply: number, amount: number): number {
  if (supply <= amount) return 0
  return Math.floor(getBuyPrice(supply - amount, amount) * 80 / 100)
}

export function maxSellAmount(supply: number): number {
  return Math.max(Math.floor(supply / 20), 1)
}

export function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4)
}

export function fmtSol(lamports: number): string {
  const sol = lamports / 1e9
  if (sol < 0.0001) return '<0.0001 SOL'
  return `${sol.toFixed(4)} SOL`
}

export function getMarketCap(supply: number): number {
  if (supply === 0) return 0
  return getBuyPrice(supply, 1) * supply
}
