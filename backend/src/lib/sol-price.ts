let cachedPrice = 0
let lastFetch = 0
const CACHE_MS = 60_000

export function getSolPrice(): number {
  return cachedPrice
}

async function fetchPrice() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' } }
    )
    const data = await res.json() as { solana?: { usd?: number } }
    const price = data?.solana?.usd
    if (typeof price === 'number' && price > 0) {
      cachedPrice = price
      console.log(`[sol-price] $${price}`)
    }
  } catch (e) {
    console.warn('[sol-price] fetch failed:', (e as Error).message)
  }
  lastFetch = Date.now()
}

export async function startSolPricePoller() {
  await fetchPrice()
  setInterval(fetchPrice, CACHE_MS)
}
