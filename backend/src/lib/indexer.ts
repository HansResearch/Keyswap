import { env } from '../env.js'
import { db, upsertKey, upsertTrade, updateKeyStats, getCursor, setCursor } from './db.js'
import { hexToBase58, parseHeliusLogs } from './parser.js'

const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 2_000)
const DISC_CREATE_KEY  = Buffer.from([176, 81, 20, 95, 41, 237, 96, 126])
const DISC_BUY_SHARES  = Buffer.from([40, 239, 138, 154, 8, 37, 106, 108])
const DISC_SELL_SHARES = Buffer.from([184, 164, 169, 16, 231, 158, 199, 196])

type ProgramInstruction = {
  kind: 'create' | 'trade' | 'other'
  subjectNamePda: string | null
  subjectStatePda: string | null
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function programStateAddress(): string {
  // We poll signatures for the program itself — all txs touching our program appear here
  return env.PROGRAM_ID
}

function base58Decode(input: string): Buffer {
  const bytes: number[] = []
  for (const char of input) {
    const value = BASE58.indexOf(char)
    if (value < 0) return Buffer.alloc(0)

    let carry = value
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (let i = 0; i < input.length && input[i] === '1'; i++) bytes.push(0)
  return Buffer.from(bytes.reverse())
}

function accountKeyToString(key: unknown): string | null {
  if (typeof key === 'string') return key
  if (key && typeof key === 'object' && 'pubkey' in key) {
    const pubkey = (key as { pubkey?: unknown }).pubkey
    if (typeof pubkey === 'string') return pubkey
  }
  return null
}

function decodeName(bytes: number[]): string {
  const end = bytes.indexOf(0)
  return Buffer.from(end === -1 ? bytes : bytes.slice(0, end)).toString('utf8')
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(env.SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json() as any
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function fetchNewSigs(address: string, lastSig: string | null): Promise<any[]> {
  const opts: any = { limit: 50, commitment: 'confirmed' }
  if (lastSig) opts.until = lastSig
  return rpc('getSignaturesForAddress', [address, opts])
}

async function fetchTx(sig: string): Promise<any> {
  return rpc('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])
}

async function fetchSubjectNameFromState(subjectStatePda: string | null): Promise<string | null> {
  if (!subjectStatePda) return null
  try {
    const info = await rpc('getAccountInfo', [subjectStatePda, { encoding: 'base64', commitment: 'confirmed' }])
    const encoded = info?.value?.data?.[0]
    if (!encoded) return null
    const data = Buffer.from(encoded, 'base64')
    if (data.length < 8 + 32 + 8 + 32) return null
    const nameBytes = Array.from(data.subarray(8 + 32 + 8, 8 + 32 + 8 + 32))
    const name = decodeName(nameBytes)
    return /^[a-z0-9]{3,32}$/.test(name) ? name : null
  } catch {
    return null
  }
}

function extractProgramInstructions(tx: any): ProgramInstruction[] {
  const message = tx.transaction?.message
  const accountKeys: unknown[] = message?.accountKeys ?? []
  const instructions: any[] = message?.instructions ?? []
  const keys = accountKeys.map(accountKeyToString)

  const programInstructions: ProgramInstruction[] = []

  for (const ix of instructions) {
    const programId = keys[ix.programIdIndex]
    if (programId !== env.PROGRAM_ID) continue

    const data = base58Decode(ix.data ?? '')
    const accounts: number[] = ix.accounts ?? []
    const subjectNamePda = keys[accounts[1]] ?? null
    const subjectStatePda = keys[accounts[6]] ?? null

    if (data.subarray(0, 8).equals(DISC_CREATE_KEY)) {
      programInstructions.push({ kind: 'create', subjectNamePda, subjectStatePda: keys[accounts[2]] ?? null })
      continue
    }
    if (
      data.subarray(0, 8).equals(DISC_BUY_SHARES)
      || data.subarray(0, 8).equals(DISC_SELL_SHARES)
    ) {
      programInstructions.push({ kind: 'trade', subjectNamePda, subjectStatePda })
      continue
    }
    programInstructions.push({ kind: 'other', subjectNamePda: null, subjectStatePda: null })
  }

  return programInstructions
}

async function processSig(sig: string, blockTime: number | null) {
  let tx: any
  try { tx = await fetchTx(sig) } catch { return }
  if (!tx) return

  const logs: string[] = tx.meta?.logMessages ?? []
  const events = parseHeliusLogs(logs)
  const instructions = extractProgramInstructions(tx)
  let ixCursor = 0

  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]
    const bt = blockTime ? new Date(blockTime * 1000).toISOString() : null
    const ix = instructions.slice(ixCursor).find((candidate, offset) => {
      if (candidate.kind !== event.kind) return false
      ixCursor += offset + 1
      return true
    })

    if (event.kind === 'create') {
      const creator = hexToBase58(event.creator)
      const subjectNamePda = ix?.subjectNamePda ?? null
      upsertKey({ name: event.name, creator_wallet: creator, subject_name_pda: subjectNamePda })

      // createKeyAndBuy emits CREATE then BUY in the same tx — use the BUY for amount/price
      const nextEvent = events[eventIndex + 1]
      const hasBuy = nextEvent?.kind === 'trade' && (nextEvent as any).isBuy
      upsertTrade({
        name: event.name,
        tx_sig: sig,
        event_index: eventIndex,
        trade_type: 'CREATE',
        trader: creator,
        amount: hasBuy ? (nextEvent as any).keyAmount : 0,
        price_sol: hasBuy ? Number((nextEvent as any).solAmount) : 0,
        block_time: bt,
      })

      // The launch BUY is already merged into the CREATE row above —
      // advance the loop so we don't index it again as a separate BUY row.
      if (hasBuy) {
        updateKeyStats(event.name, (nextEvent as any).supply)
        eventIndex++
      }

    } else if (event.kind === 'trade') {
      const trader  = hexToBase58(event.trader)
      const subject = hexToBase58(event.subject)
      const subjectNamePda = ix?.subjectNamePda ?? null

      let keyName: string | null = null
      if (subjectNamePda) {
        const row = db.prepare('SELECT name FROM keys WHERE subject_name_pda = ?').get(subjectNamePda) as any
        if (row) keyName = row.name
      }
      if (!keyName) {
        keyName = await fetchSubjectNameFromState(ix?.subjectStatePda ?? null)
        if (keyName && subjectNamePda) {
          upsertKey({ name: keyName, creator_wallet: subject, subject_name_pda: subjectNamePda })
        }
      }
      if (!keyName) {
        const rows = db.prepare('SELECT name FROM keys WHERE creator_wallet = ?').all(subject) as any[]
        if (rows.length === 1) keyName = rows[0].name
      }
      if (!keyName) continue

      updateKeyStats(keyName, event.supply)
      upsertTrade({
        name: keyName,
        tx_sig: sig,
        event_index: eventIndex,
        trade_type: event.isBuy ? 'BUY' : 'SELL',
        trader,
        amount: event.keyAmount,
        price_sol: Number(event.solAmount),
        block_time: bt,
      })
    }
  }
}

export async function startIndexer() {
  console.log(`[indexer] polling ${env.SOLANA_RPC} every ${POLL_MS / 1000}s`)

  async function tick() {
    try {
      const addr = programStateAddress()
      const lastSig = getCursor(addr)
      const sigs = await fetchNewSigs(addr, lastSig)
      if (!sigs.length) return

      // Process oldest-first so cursor advances correctly
      for (const s of [...sigs].reverse()) {
        try {
          await processSig(s.signature, s.blockTime)
        } catch (e) {
          console.warn('[indexer] process error:', s.signature, (e as Error).message)
        }
      }

      setCursor(addr, sigs[0].signature)
    } catch (e) {
      console.warn('[indexer] tick error:', (e as Error).message)
    }
  }

  await tick()
  setInterval(tick, POLL_MS)
}
