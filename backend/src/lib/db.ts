import Database from 'better-sqlite3'
import { env } from '../env.js'

export const db = new Database(env.DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    name              TEXT PRIMARY KEY,
    creator_wallet    TEXT NOT NULL,
    subject_name_pda  TEXT UNIQUE,
    pfp_url           TEXT,
    x_url             TEXT,
    telegram_url      TEXT,
    website_url       TEXT,
    comm_url          TEXT,
    supply            INTEGER NOT NULL DEFAULT 1,
    price_floor       INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL REFERENCES keys(name) ON DELETE CASCADE,
    tx_sig      TEXT NOT NULL,
    event_index INTEGER NOT NULL DEFAULT 0,
    trade_type  TEXT NOT NULL CHECK (trade_type IN ('BUY','SELL','CREATE')),
    trader      TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    price_sol   INTEGER NOT NULL,
    block_time  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tx_sig, event_index)
  );

  CREATE INDEX IF NOT EXISTS trades_name_idx ON trades(name);
  CREATE INDEX IF NOT EXISTS trades_block_time_idx ON trades(block_time DESC);
  CREATE INDEX IF NOT EXISTS keys_updated_at_idx ON keys(updated_at DESC);

  CREATE TABLE IF NOT EXISTS indexer_cursors (
    address TEXT PRIMARY KEY,
    last_sig TEXT
  );

  CREATE TABLE IF NOT EXISTS holder_thesis (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    wallet     TEXT NOT NULL,
    thesis     TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS thesis_likes (
    name   TEXT NOT NULL,
    wallet TEXT NOT NULL,
    liker  TEXT NOT NULL,
    PRIMARY KEY (name, wallet, liker)
  );
`)

// Migrate: holder_thesis — add id AUTOINCREMENT, allow multiple posts per wallet
const thesisCols = db.prepare(`PRAGMA table_info(holder_thesis)`).all() as Array<{ name: string }>
const hasThesisId = thesisCols.some(c => c.name === 'id')
if (!hasThesisId) {
  db.exec(`
    CREATE TABLE holder_thesis_v2 (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      wallet     TEXT NOT NULL,
      thesis     TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO holder_thesis_v2 (name, wallet, thesis, updated_at)
      SELECT name, wallet, thesis, updated_at FROM holder_thesis;
    DROP TABLE holder_thesis;
    ALTER TABLE holder_thesis_v2 RENAME TO holder_thesis;
    CREATE INDEX IF NOT EXISTS thesis_name_idx    ON holder_thesis(name);
    CREATE INDEX IF NOT EXISTS thesis_wallet_idx  ON holder_thesis(name, wallet);
  `)
}

// Migrate: create thesis_likes if it was added after initial DB creation
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
const tableNames = new Set(tables.map(t => t.name))
if (!tableNames.has('thesis_likes')) {
  db.exec(`
    CREATE TABLE thesis_likes (
      name   TEXT NOT NULL,
      wallet TEXT NOT NULL,
      liker  TEXT NOT NULL,
      PRIMARY KEY (name, wallet, liker)
    )
  `)
}

// Migrate: add social columns if missing
const keyColumns = db.prepare(`PRAGMA table_info(keys)`).all() as Array<{ name: string }>
const keyColNames = new Set(keyColumns.map(c => c.name))
for (const col of ['x_url', 'telegram_url', 'website_url', 'comm_url']) {
  if (!keyColNames.has(col)) db.exec(`ALTER TABLE keys ADD COLUMN ${col} TEXT`)
}

const tradeColumns = db.prepare(`PRAGMA table_info(trades)`).all() as Array<{ name: string }>
const tradeIndexes = db.prepare(`PRAGMA index_list(trades)`).all() as Array<{ name: string; unique: number }>
const hasEventIndex = tradeColumns.some((col) => col.name === 'event_index')
const hasLegacyTxUnique = tradeIndexes.some((idx) => {
  if (!idx.unique) return false
  const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as Array<{ name: string }>
  return cols.length === 1 && cols[0]?.name === 'tx_sig'
})

if (!hasEventIndex || hasLegacyTxUnique) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL REFERENCES keys(name) ON DELETE CASCADE,
      tx_sig      TEXT NOT NULL,
      event_index INTEGER NOT NULL DEFAULT 0,
      trade_type  TEXT NOT NULL CHECK (trade_type IN ('BUY','SELL','CREATE')),
      trader      TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      price_sol   INTEGER NOT NULL,
      block_time  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tx_sig, event_index)
    );

    INSERT OR IGNORE INTO trades_v2
      (id, name, tx_sig, event_index, trade_type, trader, amount, price_sol, block_time, created_at)
    SELECT
      id, name, tx_sig, 0, trade_type, trader, amount, price_sol, block_time, created_at
    FROM trades;

    DROP TABLE trades;
    ALTER TABLE trades_v2 RENAME TO trades;

    CREATE INDEX IF NOT EXISTS trades_name_idx ON trades(name);
    CREATE INDEX IF NOT EXISTS trades_block_time_idx ON trades(block_time DESC);
  `)
}

// Idempotent cleanup — remove duplicate BUY rows for launch txs that also have
// a CREATE row in the same tx (the launch BUY is already merged into CREATE).
const dupCleanup = db.prepare(`
  DELETE FROM trades
  WHERE trade_type = 'BUY'
    AND tx_sig IN (SELECT tx_sig FROM trades WHERE trade_type = 'CREATE')
`).run()
if (dupCleanup.changes > 0) {
  console.log(`[db] cleaned up ${dupCleanup.changes} duplicate launch-BUY rows`)
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

export function upsertKey(row: {
  name: string
  creator_wallet: string
  subject_name_pda?: string | null
  pfp_url?: string | null
  x_url?: string | null
  telegram_url?: string | null
  website_url?: string | null
  comm_url?: string | null
  supply?: number
  price_floor?: number
}) {
  db.prepare(`
    INSERT INTO keys (name, creator_wallet, subject_name_pda, pfp_url, x_url, telegram_url, website_url, comm_url, supply, price_floor)
    VALUES (@name, @creator_wallet, @subject_name_pda, @pfp_url, @x_url, @telegram_url, @website_url, @comm_url, @supply, @price_floor)
    ON CONFLICT(name) DO UPDATE SET
      creator_wallet   = COALESCE(excluded.creator_wallet, creator_wallet),
      subject_name_pda = COALESCE(excluded.subject_name_pda, subject_name_pda),
      pfp_url          = COALESCE(excluded.pfp_url, pfp_url),
      x_url            = COALESCE(excluded.x_url, x_url),
      telegram_url     = COALESCE(excluded.telegram_url, telegram_url),
      website_url      = COALESCE(excluded.website_url, website_url),
      comm_url         = COALESCE(excluded.comm_url, comm_url),
      -- Do NOT touch supply or price_floor on conflict. Those are managed by
      -- updateKeyStats (driven by on-chain TradeEvent.supply). Touching them
      -- here would reset supply back to the default of 1 on every re-index.
      updated_at       = datetime('now')
  `).run({
    name: row.name,
    creator_wallet: row.creator_wallet,
    subject_name_pda: row.subject_name_pda ?? null,
    pfp_url: row.pfp_url ?? null,
    x_url: row.x_url ?? null,
    telegram_url: row.telegram_url ?? null,
    website_url: row.website_url ?? null,
    comm_url: row.comm_url ?? null,
    supply: row.supply ?? 1,
    price_floor: row.price_floor ?? 0,
  })
}

export function updateKeyStats(name: string, supply: number) {
  db.prepare(`
    UPDATE keys SET supply = ?, updated_at = datetime('now') WHERE name = ?
  `).run(supply, name)
}

export function upsertTrade(row: {
  name: string
  tx_sig: string
  event_index?: number
  trade_type: 'BUY' | 'SELL' | 'CREATE'
  trader: string
  amount: number
  price_sol: number
  block_time?: string | null
}) {
  db.prepare(`
    INSERT INTO trades (name, tx_sig, event_index, trade_type, trader, amount, price_sol, block_time)
    VALUES (@name, @tx_sig, @event_index, @trade_type, @trader, @amount, @price_sol, @block_time)
    ON CONFLICT(tx_sig, event_index) DO UPDATE SET
      name       = excluded.name,
      trade_type = excluded.trade_type,
      trader     = excluded.trader,
      amount     = excluded.amount,
      price_sol  = excluded.price_sol,
      block_time = COALESCE(excluded.block_time, block_time)
  `).run({ ...row, event_index: row.event_index ?? 0, block_time: row.block_time ?? null })
}

export function getCursor(address: string): string | null {
  const row = db.prepare('SELECT last_sig FROM indexer_cursors WHERE address = ?').get(address) as any
  return row?.last_sig ?? null
}

export function setCursor(address: string, sig: string) {
  db.prepare(`
    INSERT INTO indexer_cursors (address, last_sig) VALUES (?, ?)
    ON CONFLICT(address) DO UPDATE SET last_sig = excluded.last_sig
  `).run(address, sig)
}
