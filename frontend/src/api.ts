const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export type ApiKey = {
  name: string
  creator_wallet: string
  pfp_url: string | null
  supply: number
  price_floor: number
  created_at: string
  updated_at: string
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

export async function fetchKeys(limit = 50, offset = 0): Promise<ApiKey[]> {
  const r = await fetch(`${BASE}/api/keys?limit=${limit}&offset=${offset}`)
  if (!r.ok) throw new Error('Failed to fetch keys')
  return r.json()
}

export async function fetchKey(name: string): Promise<{ key: ApiKey; trades: ApiTrade[] }> {
  const r = await fetch(`${BASE}/api/keys/${name}`)
  if (!r.ok) throw new Error('Key not found')
  return r.json()
}

export async function registerKey(params: {
  name: string
  creatorWallet: string
  subjectNamePda: string
}): Promise<void> {
  await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export async function uploadPfp(name: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('name', name)
  form.append('file', file)
  const r = await fetch(`${BASE}/api/upload-pfp`, { method: 'POST', body: form })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(error)
  }
  const { url } = await r.json()
  return url as string
}
