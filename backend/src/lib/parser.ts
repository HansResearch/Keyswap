import { createHash } from 'crypto'

function disc(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8)
}

const DISC_TRADE  = disc('TradeEvent')
const DISC_CREATE = disc('KeyCreatedEvent')

function u64(buf: Buffer, off: number): bigint {
  return buf.readBigUInt64LE(off)
}

function pubkey(buf: Buffer, off: number): string {
  return buf.subarray(off, off + 32).toString('hex')
}

// TradeEvent field order (Borsh):
// trader: Pubkey(32), subject: Pubkey(32), is_buy: bool(1),
// key_amount: u64(8), sol_amount: u64(8), protocol_fee: u64(8),
// subject_fee: u64(8), royalty_fee: u64(8), supply: u64(8)
export type TradeEvent = {
  kind: 'trade'
  trader: string    // hex
  subject: string   // hex (creator wallet)
  isBuy: boolean
  keyAmount: number
  solAmount: bigint // lamports
  supply: number
}

// KeyCreatedEvent field order (Borsh):
// creator: Pubkey(32), name: String(4-byte len prefix + utf8 bytes)
export type CreateEvent = {
  kind: 'create'
  creator: string  // hex
  name: string
}

export type ParsedEvent = TradeEvent | CreateEvent

export function parseHeliusLogs(logMessages: string[]): ParsedEvent[] {
  const events: ParsedEvent[] = []

  for (const log of logMessages) {
    const m = log.match(/^Program data: (.+)$/)
    if (!m) continue

    let raw: Buffer
    try { raw = Buffer.from(m[1], 'base64') } catch { continue }
    if (raw.length < 8) continue

    const d = raw.subarray(0, 8)

    if (d.equals(DISC_TRADE)) {
      if (raw.length < 8 + 32 + 32 + 1 + 6 * 8) continue
      let off = 8
      const trader  = pubkey(raw, off); off += 32
      const subject = pubkey(raw, off); off += 32
      const isBuy   = raw[off] === 1;   off += 1
      const keyAmount = Number(u64(raw, off)); off += 8
      const solAmount = u64(raw, off);         off += 8
      off += 8 + 8 + 8  // skip protocol_fee, subject_fee, royalty_fee
      const supply    = Number(u64(raw, off))
      events.push({ kind: 'trade', trader, subject, isBuy, keyAmount, solAmount, supply })

    } else if (d.equals(DISC_CREATE)) {
      if (raw.length < 8 + 32 + 4) continue
      let off = 8
      const creator = pubkey(raw, off); off += 32
      const nameLen = raw.readUInt32LE(off); off += 4
      if (raw.length < off + nameLen) continue
      const name = raw.subarray(off, off + nameLen).toString('utf8')
      events.push({ kind: 'create', creator, name })
    }
  }

  return events
}

export function hexToBase58(hex: string): string {
  // bs58 encode
  const bytes = Buffer.from(hex, 'hex')
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let d: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < d.length; i++) {
      carry += d[i] << 8
      d[i] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry) { d.push(carry % 58); carry = Math.floor(carry / 58) }
  }
  let out = ''
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1'
  for (let i = d.length - 1; i >= 0; i--) out += ALPHABET[d[i]]
  return out
}
