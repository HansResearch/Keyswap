import { Hono } from 'hono'
import { db, upsertKey } from '../lib/db.js'

export const keysRouter = new Hono()

// GET /api/keys?limit=50&offset=0
// Joins on trades to compute 24h volume (sum of price_sol over last 24h) per key.
// Without this, the frontend has no volume data for the home-page list, since
// the bulk `/api/keys` endpoint never carried trades. `vol_24h` is in lamports.
keysRouter.get('/', (c) => {
  const limit  = Math.min(Number(c.req.query('limit')  ?? 50), 100)
  const offset = Number(c.req.query('offset') ?? 0)
  const rows = db.prepare(`
    SELECT
      k.*,
      COALESCE(SUM(CASE
        WHEN t.block_time >= datetime('now', '-24 hours')
        THEN t.price_sol ELSE 0 END), 0) AS vol_24h
    FROM keys k
    LEFT JOIN trades t ON t.name = k.name
    GROUP BY k.name
    ORDER BY k.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset)
  return c.json(rows)
})

// POST /api/keys — register a newly created key from the frontend
keysRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const name: string = body?.name?.toLowerCase() ?? ''
  const creatorWallet: string = body?.creatorWallet ?? ''
  const subjectNamePda: string = body?.subjectNamePda ?? ''

  if (!/^[a-z0-9]{3,32}$/.test(name) || !creatorWallet || !subjectNamePda) {
    return c.json({ error: 'Invalid params' }, 400)
  }

  upsertKey({ name, creator_wallet: creatorWallet, subject_name_pda: subjectNamePda })
  return c.json({ ok: true })
})

// GET /api/keys/:name/holders — compute balances from indexed trades
keysRouter.get('/:name/holders', (c) => {
  const name = c.req.param('name').toLowerCase()
  const rows = db.prepare(`
    SELECT
      trader AS wallet,
      SUM(CASE
        WHEN trade_type IN ('BUY','CREATE') THEN amount
        WHEN trade_type = 'SELL'           THEN -amount
        ELSE 0
      END) AS balance
    FROM trades
    WHERE name = ?
    GROUP BY trader
    HAVING balance > 0
    ORDER BY balance DESC
  `).all(name) as Array<{ wallet: string; balance: number }>
  return c.json(rows)
})

// GET /api/keys/ticker — name + supply + supply_24h_ago for scrolling ticker
keysRouter.get('/ticker', (c) => {
  const rows = db.prepare(`
    SELECT
      k.name,
      k.supply,
      k.supply - COALESCE(
        SUM(CASE
          WHEN t.trade_type IN ('BUY','CREATE') THEN t.amount
          WHEN t.trade_type = 'SELL'            THEN -t.amount
          ELSE 0
        END), 0
      ) AS supply_24h_ago
    FROM keys k
    LEFT JOIN trades t
      ON t.name = k.name
      AND t.block_time >= datetime('now', '-24 hours')
    GROUP BY k.name
    ORDER BY k.updated_at DESC
    LIMIT 30
  `).all()
  return c.json(rows)
})

// GET /api/trades/recent?limit=20
keysRouter.get('/trades/recent', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 50)
  const rows = db.prepare(
    'SELECT * FROM trades ORDER BY block_time DESC LIMIT ?'
  ).all(limit)
  return c.json(rows)
})

// PATCH /api/keys/:name — update socials (creator only, no auth for now)
keysRouter.patch('/:name', async (c) => {
  const name = c.req.param('name').toLowerCase()
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid body' }, 400)

  const allowed = ['x_url', 'telegram_url', 'website_url', 'comm_url'] as const
  const updates: string[] = []
  const values: string[] = []

  for (const col of allowed) {
    if (col in body) {
      updates.push(`${col} = ?`)
      values.push(body[col] ?? null)
    }
  }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(name)
  db.prepare(`UPDATE keys SET ${updates.join(', ')}, updated_at = datetime('now') WHERE name = ?`).run(...values)
  return c.json({ ok: true })
})

// GET /api/keys/:name?viewer=WALLET
// Metaplex Token Metadata JSON — pointed to by the on-chain `uri` field of each key's
// metadata account. Phantom / Solflare / Backpack fetch this to render image + description.
keysRouter.get('/meta/:filename', (c) => {
  const filename = c.req.param('filename') // expects "<name>.json"
  if (!filename.endsWith('.json')) return c.json({ error: 'expected .json' }, 400)
  const name = filename.slice(0, -5).toLowerCase()
  const key = db.prepare('SELECT name, pfp_url FROM keys WHERE name = ?').get(name) as
    | { name: string; pfp_url: string | null }
    | undefined
  if (!key) return c.json({ error: 'Not found' }, 404)
  return c.json({
    name: key.name,
    symbol: key.name.toUpperCase().slice(0, 10),
    description: `${key.name} — a key on the Solana keys protocol.`,
    image: key.pfp_url ?? '',
    external_url: `https://keys.app/k/${key.name}`,
  })
})

keysRouter.get('/:name', (c) => {
  const name = c.req.param('name').toLowerCase()
  const viewer = c.req.query('viewer') ?? ''
  const key = db.prepare('SELECT * FROM keys WHERE name = ?').get(name)
  if (!key) return c.json({ error: 'Not found' }, 404)

  const trades = db.prepare(
    'SELECT * FROM trades WHERE name = ? ORDER BY block_time DESC LIMIT 50'
  ).all(name)

  const thesis = db.prepare(`
    SELECT
      ht.id,
      ht.wallet,
      ht.thesis,
      ht.updated_at,
      COUNT(tl.liker)                                    AS likes,
      MAX(CASE WHEN tl.liker = ? THEN 1 ELSE 0 END)     AS liked_by_me
    FROM holder_thesis ht
    LEFT JOIN thesis_likes tl ON tl.name = ht.name AND tl.wallet = ht.wallet
    WHERE ht.name = ?
    GROUP BY ht.id
    ORDER BY ht.updated_at DESC
  `).all(viewer, name)

  return c.json({ key, trades, thesis })
})

// POST /api/keys/:name/thesis — upsert a holder thesis
keysRouter.post('/:name/thesis', async (c) => {
  const name = c.req.param('name').toLowerCase()
  const body = await c.req.json().catch(() => null)
  const wallet: string = body?.wallet ?? ''
  const thesis: string = body?.thesis ?? ''

  if (!wallet || thesis.length < 2 || thesis.length > 280) {
    return c.json({ error: 'Thesis must be 2-280 characters' }, 400)
  }

  db.prepare(`
    INSERT INTO holder_thesis (name, wallet, thesis, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(name, wallet, thesis.trim())

  return c.json({ ok: true })
})

// POST /api/keys/:name/thesis/:thesisWallet/like — toggle like
keysRouter.post('/:name/thesis/:thesisWallet/like', async (c) => {
  const name = c.req.param('name').toLowerCase()
  const thesisWallet = c.req.param('thesisWallet')
  const body = await c.req.json().catch(() => null)
  const liker: string = body?.liker ?? ''

  if (!liker) return c.json({ error: 'liker required' }, 400)

  const existing = db.prepare(
    'SELECT 1 FROM thesis_likes WHERE name = ? AND wallet = ? AND liker = ?'
  ).get(name, thesisWallet, liker)

  if (existing) {
    db.prepare('DELETE FROM thesis_likes WHERE name = ? AND wallet = ? AND liker = ?').run(name, thesisWallet, liker)
  } else {
    db.prepare('INSERT OR IGNORE INTO thesis_likes (name, wallet, liker) VALUES (?, ?, ?)').run(name, thesisWallet, liker)
  }

  const { count } = db.prepare(
    'SELECT COUNT(*) as count FROM thesis_likes WHERE name = ? AND wallet = ?'
  ).get(name, thesisWallet) as { count: number }

  return c.json({ liked: !existing, likes: count })
})
