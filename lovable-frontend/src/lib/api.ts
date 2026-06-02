// Same-origin in production (so the same build works on any domain), localhost
// fallback for `vite dev`. Override via VITE_API_URL if backend lives elsewhere.
const BASE_URL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? window.location.origin
    : 'http://localhost:3001')

export type ApiKey = {
  name: string
  creator_wallet: string
  subject_name_pda: string | null
  pfp_url: string | null
  x_url: string | null
  telegram_url: string | null
  website_url: string | null
  comm_url: string | null
  supply: number
  price_floor: number
  created_at: string
  updated_at: string
  // Computed by GET /api/keys (sum of price_sol over last 24h, in lamports).
  // Detail endpoint /api/keys/:name doesn't compute this — frontend falls back
  // to summing trades client-side there.
  vol_24h?: number
}

export type ApiTrade = {
  id: number
  name: string
  tx_sig: string
  trade_type: 'BUY' | 'SELL' | 'CREATE'
  trader: string
  amount: number
  price_sol: number
  block_time: string | null
}

export async function fetchKeys(limit = 100): Promise<ApiKey[]> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys?limit=${limit}`)
    if (!r.ok) return []
    return r.json()
  } catch { return [] }
}

export type ApiThesis = { id: number; wallet: string; thesis: string; updated_at: string; likes: number; liked_by_me: 0 | 1 | boolean }

export async function fetchKeyDetail(name: string, viewer?: string): Promise<{ key: ApiKey; trades: ApiTrade[]; thesis: ApiThesis[] } | null> {
  try {
    const url = viewer
      ? `${BASE_URL}/api/keys/${name}?viewer=${encodeURIComponent(viewer)}`
      : `${BASE_URL}/api/keys/${name}`
    const r = await fetch(url)
    if (!r.ok) return null
    return r.json()
  } catch { return null }
}

export async function likeThesis(name: string, thesisWallet: string, liker: string): Promise<{ liked: boolean; likes: number } | null> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys/${name}/thesis/${encodeURIComponent(thesisWallet)}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liker }),
    })
    if (!r.ok) return null
    return r.json()
  } catch { return null }
}

export async function registerKey(params: { name: string; creatorWallet: string; subjectNamePda: string }): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  } catch {}
}

export async function fetchSolPrice(): Promise<number> {
  try {
    const r = await fetch(`${BASE_URL}/api/sol-price`)
    if (!r.ok) return 0
    const { usd } = await r.json()
    return typeof usd === 'number' ? usd : 0
  } catch { return 0 }
}

export async function submitThesis(name: string, wallet: string, thesis: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys/${name}/thesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, thesis }),
    })
    return r.ok
  } catch { return false }
}

export async function updateKeySocials(name: string, socials: {
  x_url?: string | null
  telegram_url?: string | null
  website_url?: string | null
  comm_url?: string | null
}): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(socials),
    })
    return r.ok
  } catch { return false }
}

export type ApiTickerItem = { name: string; supply: number; supply_24h_ago: number }

export async function fetchTicker(): Promise<ApiTickerItem[]> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys/ticker`)
    if (!r.ok) return []
    return r.json()
  } catch { return [] }
}

export type ApiHolder = { wallet: string; balance: number }

export async function fetchHoldersFromApi(name: string): Promise<ApiHolder[]> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys/${name}/holders`)
    if (!r.ok) return []
    return r.json()
  } catch { return [] }
}

export async function fetchRecentTrades(limit = 20): Promise<ApiTrade[]> {
  try {
    const r = await fetch(`${BASE_URL}/api/keys/trades/recent?limit=${limit}`)
    if (!r.ok) return []
    return r.json()
  } catch { return [] }
}

export async function uploadPfp(name: string, file: File): Promise<string | null> {
  try {
    const form = new FormData()
    form.append('name', name)
    form.append('file', file)
    const r = await fetch(`${BASE_URL}/api/upload-pfp`, { method: 'POST', body: form })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('uploadPfp: HTTP', r.status, 'from', BASE_URL, '—', text)
      return null
    }
    const { url } = await r.json()
    return url
  } catch (e) {
    console.error('uploadPfp: network/CORS error to', BASE_URL, '/api/upload-pfp —', e)
    return null
  }
}
