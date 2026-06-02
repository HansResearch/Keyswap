import { Buffer } from 'buffer'
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { getBuyPrice } from '@/lib/pricing'

if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).Buffer = Buffer
}

// All sensitive values come from Vite env vars (VITE_* prefix → bundled at build).
// For local dev, copy .env.example → .env.local and fill it in.
// For production (Railway / Vercel), set these as deploy-platform env vars.
// REMINDER: VITE_RPC_URL is shipped to every browser — use a Helius key that is
// DOMAIN-RESTRICTED in the Helius dashboard so it can't be abused from elsewhere.
const REQUIRED_RPC = (import.meta.env.VITE_RPC_URL as string | undefined)
  ?? (import.meta.env.PROD
    ? (() => { throw new Error('VITE_RPC_URL must be set for production builds') })()
    : 'http://localhost:8899') // local validator default for dev w/o key

const REQUIRED_PROGRAM_ID = (import.meta.env.VITE_PROGRAM_ID as string | undefined)
  ?? (import.meta.env.PROD
    ? (() => { throw new Error('VITE_PROGRAM_ID must be set for production builds') })()
    : '983hyfdeswchDLV8epdLGHBCDwTVrkg8BGdxZv5pgMCf')

export const PROGRAM_ID = new PublicKey(REQUIRED_PROGRAM_ID)
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
export const RPC_URL = REQUIRED_RPC

// Backend URL used as the Metaplex metadata URI base.
// In production, frontend + backend share a domain (e.g. https://keyswap.fun/api/...).
// In local dev, backend runs on :3001 while the Vite dev server is on :5174.
const BACKEND_ORIGIN = (import.meta.env.VITE_BACKEND_URL as string | undefined)
  ?? (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? window.location.origin
    : 'http://localhost:3001')
const METADATA_BASE_URL = `${BACKEND_ORIGIN}/api/keys/meta`

// ─── Discriminators (sha256("global:<snake_name>").slice(0,8)) ────────────────
const DISC_CREATE_KEY              = Buffer.from([176, 81,  20,  95,  41, 237, 96, 126])
const DISC_BUY_SHARES              = Buffer.from([40,  239, 138, 154,  8,  37, 106, 108])
const DISC_SELL_SHARES             = Buffer.from([184, 164, 169,  16, 231, 158, 199, 196])
const DISC_CONFIG                  = Buffer.from([207,  91, 250,  28, 152, 179, 215, 209])
const DISC_SUBJECT_STATE           = Buffer.from([149,  42,  66, 246, 114, 187, 174, 102])
const DISC_SET_ROYALTY_WALLET      = Buffer.from([152, 110, 136, 177, 123, 150, 203, 169])
const DISC_PROPOSE_FEES            = Buffer.from([70,  58,  218, 219, 33,  84,  215, 198])
const DISC_APPLY_FEES              = Buffer.from([128, 214, 87,  255, 218, 119, 107, 215])
const DISC_PROPOSE_FEE_DESTINATION = Buffer.from([98,  216, 232, 3,   17,  106, 232, 107])
const DISC_APPLY_FEE_DESTINATION   = Buffer.from([134, 197, 209, 20,  132, 72,  11,  161])

// ─── PDAs ─────────────────────────────────────────────────────────────────────

export function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)
  return pda
}

export function getSubjectNamePda(name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('name'), Buffer.from(name)],
    PROGRAM_ID,
  )
  return pda
}

export function getSubjectStatePda(subjectNamePda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('subject'), subjectNamePda.toBuffer()],
    PROGRAM_ID,
  )
  return pda
}

export function getMintPda(subjectNamePda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint'), subjectNamePda.toBuffer()],
    PROGRAM_ID,
  )
  return pda
}

// Metaplex Token Metadata PDA — derived from the mint per the Metaplex standard.
// The on-chain Metaplex program validates that the metadata address matches this
// derivation, so passing a wrong address makes the CPI revert.
export function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )
  return pda
}

export function getFeeProposalPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('fee_proposal')], PROGRAM_ID)
  return pda
}

export function getFeeDestinationProposalPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('fee_dest_proposal')], PROGRAM_ID)
  return pda
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

function encodeU64(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8)
  const v = BigInt(value)
  buf.writeBigUInt64LE(v)
  return buf
}

function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(bytes.length, 0)
  return Buffer.concat([len, bytes])
}

// ─── Account types ────────────────────────────────────────────────────────────

export type ConfigAccount = {
  authority: PublicKey
  feeDestination: PublicKey
  burnDestination: PublicKey
  protocolFeePercent: number
  subjectFeePercent: number
  bump: number
}

export type SubjectStateAccount = {
  subject: PublicKey
  supply: number
  priceFloor: number
  name: number[]
  hasName: boolean
  royaltyWallet: PublicKey
  royaltyPercent: number
  mintBump: number
  bump: number
}

// ─── Manual Borsh decode helpers ─────────────────────────────────────────────

function readPubkey(buf: Buffer, offset: number): [PublicKey, number] {
  const bytes = buf.slice(offset, offset + 32)
  return [new PublicKey(bytes), offset + 32]
}

function readU64(buf: Buffer, offset: number): [number, number] {
  const lo = buf.readUInt32LE(offset)
  const hi = buf.readUInt32LE(offset + 4)
  return [hi * 0x100000000 + lo, offset + 8]
}

function readU8(buf: Buffer, offset: number): [number, number] {
  return [buf.readUInt8(offset), offset + 1]
}

function readI64(buf: Buffer, offset: number): [bigint, number] {
  const lo = BigInt(buf.readUInt32LE(offset))
  const hi = BigInt(buf.readInt32LE(offset + 4))
  return [(hi << 32n) | lo, offset + 8]
}

// ─── On-chain reads ───────────────────────────────────────────────────────────

// Config is set once at protocol init and never changes — cache for the session.
let _configCache: ConfigAccount | null = null
let _configPromise: Promise<ConfigAccount | null> | null = null

type CachedBlockhash = Awaited<ReturnType<Connection['getLatestBlockhash']>> & { fetchedAt: number }
let _blockhashCache: CachedBlockhash | null = null
let _blockhashPromise: Promise<CachedBlockhash> | null = null

const BLOCKHASH_MAX_AGE_MS = 30_000
const SUBJECT_STATE_MAX_AGE_MS = 15_000
const subjectStateCache = new Map<string, { value: SubjectStateAccount; fetchedAt: number }>()
const subjectStatePromises = new Map<string, Promise<SubjectStateAccount | null>>()

export async function fetchConfig(
  connection: Connection,
): Promise<ConfigAccount | null> {
  if (_configCache) return _configCache
  if (_configPromise) return _configPromise
  _configPromise = fetchConfigUncached(connection).finally(() => {
    _configPromise = null
  })
  return _configPromise
}

async function fetchConfigUncached(connection: Connection): Promise<ConfigAccount | null> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
    try {
      const info = await connection.getAccountInfo(getConfigPda())
      if (!info) continue
      const data = Buffer.from(info.data)
      // layout: authority(32) feeDestination(32) burnDestination(32)
      //         protocolFeePercent(8) subjectFeePercent(8) bump(1)
      let off = 8
      let authority: PublicKey, feeDestination: PublicKey, burnDestination: PublicKey
      ;[authority, off]        = readPubkey(data, off)
      ;[feeDestination, off]   = readPubkey(data, off)
      ;[burnDestination, off]  = readPubkey(data, off)
      let protocolFeePercent: number, subjectFeePercent: number, bump: number
      ;[protocolFeePercent, off] = readU64(data, off)
      ;[subjectFeePercent, off]  = readU64(data, off)
      ;[bump, off]               = readU8(data, off)
      _configCache = { authority, feeDestination, burnDestination, protocolFeePercent, subjectFeePercent, bump }
      return _configCache
    } catch (e) {
      lastErr = e
    }
  }
  console.error('fetchConfig failed after retries:', lastErr)
  return null
}

async function fetchLatestBlockhash(connection: Connection): Promise<CachedBlockhash> {
  const latest = await connection.getLatestBlockhash('confirmed')
  return { ...latest, fetchedAt: Date.now() }
}

export async function prefetchBlockhash(connection: Connection): Promise<void> {
  const now = Date.now()
  if (_blockhashCache && now - _blockhashCache.fetchedAt < BLOCKHASH_MAX_AGE_MS) return
  if (!_blockhashPromise) {
    _blockhashPromise = fetchLatestBlockhash(connection).then((latest) => {
      _blockhashCache = latest
      return latest
    }).finally(() => {
      _blockhashPromise = null
    })
  }
  await _blockhashPromise
}

async function getSigningBlockhash(connection: Connection): Promise<CachedBlockhash> {
  const now = Date.now()
  if (_blockhashCache && now - _blockhashCache.fetchedAt < BLOCKHASH_MAX_AGE_MS) {
    return _blockhashCache
  }
  if (_blockhashPromise) return _blockhashPromise
  _blockhashPromise = fetchLatestBlockhash(connection).then((latest) => {
    _blockhashCache = latest
    return latest
  }).finally(() => {
    _blockhashPromise = null
  })
  return _blockhashPromise
}

export async function fetchSubjectStateByName(
  connection: Connection,
  name: string,
): Promise<SubjectStateAccount | null> {
  const cached = subjectStateCache.get(name)
  if (cached && Date.now() - cached.fetchedAt < SUBJECT_STATE_MAX_AGE_MS) return cached.value

  const existing = subjectStatePromises.get(name)
  if (existing) return existing

  const promise = fetchSubjectStateByNameUncached(connection, name).then((state) => {
    if (state) subjectStateCache.set(name, { value: state, fetchedAt: Date.now() })
    return state
  }).finally(() => {
    subjectStatePromises.delete(name)
  })
  subjectStatePromises.set(name, promise)
  return promise
}

async function fetchSubjectStateByNameUncached(
  connection: Connection,
  name: string,
): Promise<SubjectStateAccount | null> {
  try {
    const namePda = getSubjectNamePda(name)
    const statePda = getSubjectStatePda(namePda)
    const info = await connection.getAccountInfo(statePda)
    if (!info) return null
    const data = Buffer.from(info.data)
    // layout: subject(32) supply(8) priceFloor(8 legacy/reserved) name[32](32) hasName(1)
    //         royaltyWallet(32) royaltyPercent(8) mintBump(1) bump(1)
    let off = 8
    let subject: PublicKey, royaltyWallet: PublicKey
    let supply: number, priceFloor: number, royaltyPercent: number
    let mintBump: number, bump: number
    ;[subject, off] = readPubkey(data, off)
    ;[supply, off] = readU64(data, off)
    ;[priceFloor, off] = readU64(data, off)
    const nameBytes = Array.from(data.slice(off, off + 32)); off += 32
    const hasName = data.readUInt8(off) !== 0; off += 1
    ;[royaltyWallet, off] = readPubkey(data, off)
    ;[royaltyPercent, off] = readU64(data, off)
    ;[mintBump, off] = readU8(data, off)
    ;[bump, off] = readU8(data, off)
    return { subject, supply, priceFloor, name: nameBytes, hasName, royaltyWallet, royaltyPercent, mintBump, bump }
  } catch {
    return null
  }
}

export async function prefetchTradeContext(
  connection: Connection,
  name?: string,
): Promise<void> {
  await Promise.allSettled([
    fetchConfig(connection),
    prefetchBlockhash(connection),
    name ? fetchSubjectStateByName(connection, name) : Promise.resolve(null),
  ])
}

export async function fetchHolderBalance(
  connection: Connection,
  subjectNamePda: PublicKey,
  holder: PublicKey,
): Promise<number> {
  try {
    const mint = getMintPda(subjectNamePda)
    const ata = getAssociatedTokenAddressSync(mint, holder)
    const info = await connection.getTokenAccountBalance(ata)
    return Number(info.value.amount)
  } catch {
    return 0
  }
}

export type Holder = {
  wallet: string
  balance: number
}

export async function fetchHolders(
  connection: Connection,
  keyName: string,
): Promise<Holder[]> {
  try {
    const namePda = getSubjectNamePda(keyName)
    const mint = getMintPda(namePda)
    // Fetch all SPL token accounts for this mint
    const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: mint.toBase58() } },
      ],
    })
    const holders: Holder[] = []
    for (const { account } of accounts) {
      const data = Buffer.from(account.data)
      // owner is at offset 32, amount (u64 LE) at offset 64
      const owner = new PublicKey(data.slice(32, 64)).toBase58()
      const lo = data.readUInt32LE(64)
      const hi = data.readUInt32LE(68)
      const balance = hi * 0x100000000 + lo
      if (balance > 0) holders.push({ wallet: owner, balance })
    }
    holders.sort((a, b) => b.balance - a.balance)
    return holders
  } catch {
    return []
  }
}

// ─── Wallet adapter type ──────────────────────────────────────────────────────

type WalletAdapter = {
  publicKey: PublicKey
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>
  signAllTransactions?: <T extends Transaction>(txs: T[]) => Promise<T[]>
  sendTransaction?: (tx: Transaction, connection: Connection, options?: any) => Promise<string>
}

export type PreparedTransaction = {
  tx: Transaction
  blockhash: string
  lastValidBlockHeight: number
  createdAt: number
  cacheKey: string
}

function prepareTransaction(
  tx: Transaction,
  wallet: PublicKey,
  latest: Awaited<ReturnType<typeof getSigningBlockhash>>,
  cacheKey: string,
): PreparedTransaction {
  tx.recentBlockhash = latest.blockhash
  tx.feePayer = wallet
  return {
    tx,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    createdAt: Date.now(),
    cacheKey,
  }
}

export async function signAndSendPrepared(
  connection: Connection,
  wallet: WalletAdapter,
  prepared: PreparedTransaction,
): Promise<string> {
  const { tx, blockhash, lastValidBlockHeight } = prepared
  const started = performance.now()

  if (wallet.sendTransaction) {
    console.debug('[wallet-timing] sendTransaction:start', { cacheKey: prepared.cacheKey, ageMs: Math.round(Date.now() - prepared.createdAt) })
    const sig = await wallet.sendTransaction(tx, connection, {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    })
    console.debug('[wallet-timing] sendTransaction:resolved', { ms: Math.round(performance.now() - started), sig })
    await pollConfirmation(connection, sig, lastValidBlockHeight)
    return sig
  }

  // Wallet popup appears here. This fallback performs no RPC before signing.
  console.debug('[wallet-timing] signTransaction:start', { cacheKey: prepared.cacheKey, ageMs: Math.round(Date.now() - prepared.createdAt) })
  const signed = await wallet.signTransaction(tx)
  console.debug('[wallet-timing] signTransaction:resolved', { ms: Math.round(performance.now() - started) })
  const serialized = signed.serialize()

  // Retry send up to 3 times on 429
  let sig: string | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt))
    try {
      sig = await connection.sendRawTransaction(serialized, {
        skipPreflight: true, // skip simulation — saves one RPC call, errors still surface on-chain
      })
      break
    } catch (e: any) {
      if (attempt === 2 || !String(e?.message ?? e).includes('429')) throw e
    }
  }
  if (!sig) throw new Error('Failed to send transaction after retries')

  try {
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  } catch {
    // confirmTransaction can 429 too — fall back to polling
    await pollConfirmation(connection, sig, lastValidBlockHeight)
    return sig // pollConfirmation already throws on tx err
  }
  // confirmTransaction resolves once the tx reaches commitment, REGARDLESS of
  // whether the tx itself reverted. We MUST check the on-chain status separately
  // and throw if it errored — otherwise the caller (e.g. launch.tsx) thinks
  // success and creates phantom DB rows / wallet popups for a tx that reverted.
  const status = await connection.getSignatureStatus(sig)
  if (status?.value?.err) {
    const code = extractAnchorCode(status.value.err)
    const msg = code ? ANCHOR_ERRORS[code] : null
    throw new Error(msg ?? 'Transaction reverted on-chain: ' + JSON.stringify(status.value.err))
  }
  return sig
}

async function signAndSend(
  connection: Connection,
  wallet: WalletAdapter,
  tx: Transaction,
  cacheKey: string,
): Promise<string> {
  const prepared = prepareTransaction(tx, wallet.publicKey, await getSigningBlockhash(connection), cacheKey)
  return signAndSendPrepared(connection, wallet, prepared)
}

// Anchor error codes (6000 + enum index) — keep in sync with friendtech-final/src/errors.rs
const ANCHOR_ERRORS: Record<number, string> = {
  6001: 'Cannot sell the last key',
  6002: 'You do not hold enough keys',
  6013: 'Royalty wallet does not match this key',
  6018: 'Price moved too much — please refresh and try again',
  6020: 'Fee timelock has not elapsed (48 hours required)',
  6021: 'That address must be a regular wallet (not a program account)',
}

function extractAnchorCode(err: unknown): number | null {
  try {
    const str = JSON.stringify(err)
    const m = str.match(/"Custom":(\d+)/)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

async function pollConfirmation(connection: Connection, sig: string, lastValidBlockHeight: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const status = await connection.getSignatureStatus(sig)
      const conf = status?.value?.confirmationStatus
      if (conf === 'confirmed' || conf === 'finalized') return
      if (status?.value?.err) {
        const code = extractAnchorCode(status.value.err)
        const msg = code ? ANCHOR_ERRORS[code] : null
        throw new Error(msg ?? 'Transaction failed: ' + JSON.stringify(status.value.err))
      }
      const slot = await connection.getSlot('confirmed').catch(() => 0)
      if (slot > lastValidBlockHeight) throw new Error('Transaction expired — please try again')
    } catch (e: any) {
      if (!String(e?.message ?? e).includes('429')) throw e
    }
  }
  throw new Error('Transaction confirmation timed out')
}

// ─── Slippage helpers ─────────────────────────────────────────────────────────

// Computes max_cost for a buy: estimated price-curve cost × 115% to cover fees + 5% slippage buffer.
// The on-chain contract adds fees on top of the curve price, so this buffer needs to cover both.
// Protocol + subject fees are capped at 20% combined, so 115% is always more than enough.
function buyMaxCost(supply: number, amount: number): bigint {
  const price = getBuyPrice(supply, amount)
  return BigInt(Math.ceil(price * 1.15))
}

// ─── Instructions ─────────────────────────────────────────────────────────────

export async function createKeyAndBuy(
  connection: Connection,
  wallet: WalletAdapter,
  name: string,
  feeDestination: PublicKey,
  initialBuyAmount: number = 1,
  options: { skipNameCheck?: boolean } = {},
): Promise<string> {
  const prepared = await prepareCreateKeyAndBuyTransaction(connection, wallet.publicKey, name, feeDestination, initialBuyAmount, options)
  return signAndSendPrepared(connection, wallet, prepared)
}

export async function prepareCreateKeyAndBuyTransaction(
  connection: Connection,
  creator: PublicKey,
  name: string,
  feeDestination: PublicKey,
  initialBuyAmount: number = 1,
  options: { skipNameCheck?: boolean } = {},
): Promise<PreparedTransaction> {
  const subjectNamePda = getSubjectNamePda(name)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const mintPda = getMintPda(subjectNamePda)
  const metadataPda = getMetadataPda(mintPda)
  const buyerAta = getAssociatedTokenAddressSync(mintPda, creator)

  // Launch page already performs a debounced availability check while typing.
  if (!options.skipNameCheck) {
    const nameInfo = await connection.getAccountInfo(subjectNamePda)
    if (nameInfo) throw new Error(`The name "${name}" is already taken.`)
  }

  // ix1: create_key — also creates the Metaplex metadata so wallets show the key name
  const metadataUri = `${METADATA_BASE_URL}/${name}.json`
  const createData = Buffer.concat([DISC_CREATE_KEY, encodeString(name), encodeString(metadataUri)])
  const ix1 = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: creator,         isSigner: true,  isWritable: true  },
      { pubkey: subjectNamePda,  isSigner: false, isWritable: true  },
      { pubkey: subjectStatePda, isSigner: false, isWritable: true  },
      { pubkey: mintPda,         isSigner: false, isWritable: true  },
      { pubkey: metadataPda,     isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,           isSigner: false, isWritable: false },
      { pubkey: METADATA_PROGRAM_ID,        isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,    isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,         isSigner: false, isWritable: false },
    ],
    data: createData,
  })

  // ix2: buy_shares(amount, max_cost) — supply is 0 at creation so price is deterministic
  const buyData = Buffer.concat([DISC_BUY_SHARES, encodeU64(initialBuyAmount), encodeU64(buyMaxCost(0, initialBuyAmount))])
  const ix2 = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: creator,                       isSigner: true,  isWritable: true  },
      { pubkey: subjectNamePda,                isSigner: false, isWritable: false },
      { pubkey: creator,                       isSigner: false, isWritable: true  }, // subject = creator
      { pubkey: getConfigPda(),                isSigner: false, isWritable: false },
      { pubkey: feeDestination,                isSigner: false, isWritable: true  },
      { pubkey: creator,                       isSigner: false, isWritable: true  }, // royaltyWallet = creator
      { pubkey: subjectStatePda,               isSigner: false, isWritable: true  },
      { pubkey: mintPda,                       isSigner: false, isWritable: true  },
      { pubkey: buyerAta,                      isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,             isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,      isSigner: false, isWritable: false },
    ],
    data: buyData,
  })

  const tx = new Transaction().add(ix1, ix2)
  return prepareTransaction(
    tx,
    creator,
    await getSigningBlockhash(connection),
    `launch:${creator.toBase58()}:${name}:${initialBuyAmount}`,
  )
}

export async function buyShares(
  connection: Connection,
  wallet: WalletAdapter,
  name: string,
  amount: number,
  currentSupply: number,
  creatorWallet: PublicKey,
  feeDestination: PublicKey,
  royaltyWallet: PublicKey,
): Promise<string> {
  const prepared = await prepareBuySharesTransaction(
    connection,
    wallet.publicKey,
    name,
    amount,
    currentSupply,
    creatorWallet,
    feeDestination,
    royaltyWallet,
  )
  return signAndSendPrepared(connection, wallet, prepared)
}

export async function prepareBuySharesTransaction(
  connection: Connection,
  buyer: PublicKey,
  name: string,
  amount: number,
  currentSupply: number,
  creatorWallet: PublicKey,
  feeDestination: PublicKey,
  royaltyWallet: PublicKey,
): Promise<PreparedTransaction> {
  const subjectNamePda = getSubjectNamePda(name)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const mintPda = getMintPda(subjectNamePda)
  const buyerAta = getAssociatedTokenAddressSync(mintPda, buyer)

  const data = Buffer.concat([DISC_BUY_SHARES, encodeU64(amount), encodeU64(buyMaxCost(currentSupply, amount))])
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer,                         isSigner: true,  isWritable: true  },
      { pubkey: subjectNamePda,                isSigner: false, isWritable: false },
      { pubkey: creatorWallet,                 isSigner: false, isWritable: true  },
      { pubkey: getConfigPda(),                isSigner: false, isWritable: false },
      { pubkey: feeDestination,                isSigner: false, isWritable: true  },
      { pubkey: royaltyWallet,                 isSigner: false, isWritable: true  },
      { pubkey: subjectStatePda,               isSigner: false, isWritable: true  },
      { pubkey: mintPda,                       isSigner: false, isWritable: true  },
      { pubkey: buyerAta,                      isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,             isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,      isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new Transaction().add(ix)
  return prepareTransaction(
    tx,
    buyer,
    await getSigningBlockhash(connection),
    `buy:${buyer.toBase58()}:${name}:${amount}:${currentSupply}:${creatorWallet.toBase58()}:${feeDestination.toBase58()}:${royaltyWallet.toBase58()}`,
  )
}

export async function sellShares(
  connection: Connection,
  wallet: WalletAdapter,
  name: string,
  amount: number,
  creatorWallet: PublicKey,
  feeDestination: PublicKey,
  royaltyWallet: PublicKey,
): Promise<string> {
  const prepared = await prepareSellSharesTransaction(
    connection,
    wallet.publicKey,
    name,
    amount,
    creatorWallet,
    feeDestination,
    royaltyWallet,
  )
  return signAndSendPrepared(connection, wallet, prepared)
}

export async function prepareSellSharesTransaction(
  connection: Connection,
  seller: PublicKey,
  name: string,
  amount: number,
  creatorWallet: PublicKey,
  feeDestination: PublicKey,
  royaltyWallet: PublicKey,
): Promise<PreparedTransaction> {
  const subjectNamePda = getSubjectNamePda(name)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const mintPda = getMintPda(subjectNamePda)
  const sellerAta = getAssociatedTokenAddressSync(mintPda, seller)

  const data = Buffer.concat([DISC_SELL_SHARES, encodeU64(amount)])
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller,                        isSigner: true,  isWritable: true  },
      { pubkey: subjectNamePda,                isSigner: false, isWritable: false },
      { pubkey: creatorWallet,                 isSigner: false, isWritable: true  },
      { pubkey: getConfigPda(),                isSigner: false, isWritable: false },
      { pubkey: feeDestination,                isSigner: false, isWritable: true  },
      { pubkey: royaltyWallet,                 isSigner: false, isWritable: true  },
      { pubkey: subjectStatePda,               isSigner: false, isWritable: true  },
      { pubkey: mintPda,                       isSigner: false, isWritable: true  },
      { pubkey: sellerAta,                     isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,             isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,      isSigner: false, isWritable: false },
    ],
    data,
  })

  const tx = new Transaction().add(ix)
  return prepareTransaction(
    tx,
    seller,
    await getSigningBlockhash(connection),
    `sell:${seller.toBase58()}:${name}:${amount}:${creatorWallet.toBase58()}:${feeDestination.toBase58()}:${royaltyWallet.toBase58()}`,
  )
}

// ─── Royalty wallet (creator-only) ───────────────────────────────────────────

/// Change the royalty wallet + percent for a key.
/// `newRoyaltyWallet` MUST be a System-owned wallet — the program rejects PDAs
/// (otherwise future buys would silently lose royalty SOL to an inaccessible account).
export async function setRoyaltyWallet(
  connection: Connection,
  wallet: WalletAdapter,
  keyName: string,
  newRoyaltyWallet: PublicKey,
  percent: number,
): Promise<string> {
  const subjectNamePda = getSubjectNamePda(keyName)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const data = Buffer.concat([DISC_SET_ROYALTY_WALLET, encodeU64(percent)])
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey,  isSigner: true,  isWritable: false },
      { pubkey: subjectNamePda,    isSigner: false, isWritable: false },
      { pubkey: subjectStatePda,   isSigner: false, isWritable: true  },
      { pubkey: newRoyaltyWallet,  isSigner: false, isWritable: false },
    ],
    data,
  })
  const tx = new Transaction().add(ix)
  return signAndSend(connection, wallet, tx, `setRoyalty:${keyName}:${newRoyaltyWallet.toBase58()}:${percent}`)
}

// ─── Admin: fee % timelock (authority-only, 48h delay) ───────────────────────

export async function proposeFees(
  connection: Connection,
  wallet: WalletAdapter,
  protocolFeePercent: number | bigint,
  subjectFeePercent: number | bigint,
): Promise<string> {
  const data = Buffer.concat([DISC_PROPOSE_FEES, encodeU64(protocolFeePercent), encodeU64(subjectFeePercent)])
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey,            isSigner: true,  isWritable: true  },
      { pubkey: getConfigPda(),              isSigner: false, isWritable: false },
      { pubkey: getFeeProposalPda(),         isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    ],
    data,
  })
  const tx = new Transaction().add(ix)
  return signAndSend(connection, wallet, tx, `proposeFees:${protocolFeePercent}:${subjectFeePercent}`)
}

export async function applyFees(
  connection: Connection,
  wallet: WalletAdapter,
): Promise<string> {
  const data = Buffer.from(DISC_APPLY_FEES)
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey,    isSigner: true,  isWritable: true },
      { pubkey: getConfigPda(),      isSigner: false, isWritable: true },
      { pubkey: getFeeProposalPda(), isSigner: false, isWritable: true },
    ],
    data,
  })
  const tx = new Transaction().add(ix)
  return signAndSend(connection, wallet, tx, `applyFees`)
}

// ─── Admin: fee-destination timelock (authority-only, 48h delay) ─────────────

export async function proposeFeeDestination(
  connection: Connection,
  wallet: WalletAdapter,
  newDestination: PublicKey,
): Promise<string> {
  const data = Buffer.from(DISC_PROPOSE_FEE_DESTINATION)
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey,                 isSigner: true,  isWritable: true  },
      { pubkey: getConfigPda(),                   isSigner: false, isWritable: false },
      { pubkey: newDestination,                   isSigner: false, isWritable: false },
      { pubkey: getFeeDestinationProposalPda(),   isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId,          isSigner: false, isWritable: false },
    ],
    data,
  })
  const tx = new Transaction().add(ix)
  return signAndSend(connection, wallet, tx, `proposeFeeDest:${newDestination.toBase58()}`)
}

export async function applyFeeDestination(
  connection: Connection,
  wallet: WalletAdapter,
): Promise<string> {
  const data = Buffer.from(DISC_APPLY_FEE_DESTINATION)
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey,                isSigner: true,  isWritable: true },
      { pubkey: getConfigPda(),                  isSigner: false, isWritable: true },
      { pubkey: getFeeDestinationProposalPda(),  isSigner: false, isWritable: true },
    ],
    data,
  })
  const tx = new Transaction().add(ix)
  return signAndSend(connection, wallet, tx, `applyFeeDest`)
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

export function decodeName(nameBytes: number[]): string {
  const end = nameBytes.indexOf(0)
  const bytes = end === -1 ? nameBytes : nameBytes.slice(0, end)
  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}
