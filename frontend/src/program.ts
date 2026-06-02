import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ConfirmedSignatureInfo,
  Transaction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { IDL } from './idl'
import { PROGRAM_ID, DEFAULT_PROTOCOL_FEE, DEFAULT_SUBJECT_FEE } from './constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProgram = Program<any>

export function getProgram(wallet: any, connection: Connection): AnyProgram {
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  return new Program(IDL as any, PROGRAM_ID, provider)
}

// ─── PDAs ────────────────────────────────────────────────────────────────────

export function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)
  return pda
}

/** Seeds: [b"name", name.as_bytes()] */
export function getSubjectNamePda(name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('name'), Buffer.from(name)],
    PROGRAM_ID,
  )
  return pda
}

/** Seeds: [b"subject", subjectNamePda] */
export function getSubjectStatePda(subjectNamePda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('subject'), subjectNamePda.toBuffer()],
    PROGRAM_ID,
  )
  return pda
}

/** Seeds: [b"mint", subjectNamePda] */
export function getMintPda(subjectNamePda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint'), subjectNamePda.toBuffer()],
    PROGRAM_ID,
  )
  return pda
}

/** Seeds: [b"cooldown", subjectNamePda, seller] */
export function getCooldownPda(subjectNamePda: PublicKey, seller: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('cooldown'), subjectNamePda.toBuffer(), seller.toBuffer()],
    PROGRAM_ID,
  )
  return pda
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function decodeName(nameBytes: number[]): string {
  const end = nameBytes.indexOf(0)
  const bytes = end === -1 ? nameBytes : nameBytes.slice(0, end)
  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

// ─── Account types ────────────────────────────────────────────────────────────

export type ConfigAccount = {
  authority: PublicKey
  feeDestination: PublicKey
  burnDestination: PublicKey
  protocolFeePercent: { toNumber(): number }
  subjectFeePercent: { toNumber(): number }
  bump: number
}

export type SubjectStateAccount = {
  subject: PublicKey
  supply: { toNumber(): number }
  priceFloor: { toNumber(): number }
  name: number[]
  hasName: boolean
  royaltyWallet: PublicKey
  royaltyPercent: { toNumber(): number }
  mintBump: number
  bump: number
}

// ─── On-chain reads ───────────────────────────────────────────────────────────

export async function fetchConfig(program: AnyProgram): Promise<ConfigAccount | null> {
  try {
    return (await program.account.protocolConfig.fetch(getConfigPda())) as ConfigAccount
  } catch {
    return null
  }
}

export async function fetchSubjectStateByName(
  program: AnyProgram,
  name: string,
): Promise<SubjectStateAccount | null> {
  try {
    const namePda = getSubjectNamePda(name)
    const statePda = getSubjectStatePda(namePda)
    return (await program.account.subjectState.fetch(statePda)) as SubjectStateAccount
  } catch {
    return null
  }
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

// ─── History ─────────────────────────────────────────────────────────────────

export type TxRecord = {
  sig: string
  type: 'BUY' | 'SELL' | 'CREATE' | 'OTHER'
  blockTime: number | null | undefined
  err: boolean
}

export async function fetchHistory(
  connection: Connection,
  subjectNamePda: PublicKey,
): Promise<TxRecord[]> {
  const statePda = getSubjectStatePda(subjectNamePda)
  let sigs: ConfirmedSignatureInfo[] = []
  try {
    sigs = await connection.getSignaturesForAddress(statePda, { limit: 30 })
  } catch {
    return []
  }

  const txs = await connection.getParsedTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  )

  return sigs.map((s, i) => {
    const tx = txs[i]
    let type: TxRecord['type'] = 'OTHER'
    if (tx?.meta?.logMessages) {
      const logs = tx.meta.logMessages.join(' ')
      if (logs.includes('Instruction: BuyShares')) type = 'BUY'
      else if (logs.includes('Instruction: SellShares')) type = 'SELL'
      else if (logs.includes('Instruction: CreateKey')) type = 'CREATE'
    }
    return { sig: s.signature, type, blockTime: s.blockTime, err: s.err !== null }
  })
}

// ─── Instructions ─────────────────────────────────────────────────────────────

export async function initializeProtocol(program: AnyProgram): Promise<string> {
  const authority = (program.provider as AnchorProvider).wallet.publicKey
  return program.methods
    .initializeProtocol(new BN(DEFAULT_PROTOCOL_FEE), new BN(DEFAULT_SUBJECT_FEE))
    .accounts({
      authority,
      config: getConfigPda(),
      systemProgram: SystemProgram.programId,
    })
    .rpc()
}

export async function createKeyAndBuy(
  program: AnyProgram,
  name: string,
  feeDestination: PublicKey,
): Promise<string> {
  const creator = (program.provider as AnchorProvider).wallet.publicKey
  const connection = (program.provider as AnchorProvider).connection
  const subjectNamePda = getSubjectNamePda(name)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const mintPda = getMintPda(subjectNamePda)
  const buyerAta = getAssociatedTokenAddressSync(mintPda, creator)

  // Pre-flight: name uniqueness check
  const nameInfo = await connection.getAccountInfo(subjectNamePda)
  if (nameInfo) throw new Error(`The name "${name}" is already taken.`)

  // ix1: create_key — creates SubjectName + SubjectState + Mint in one shot
  const ix1 = await program.methods
    .createKey(name)
    .accounts({
      creator,
      subjectName: subjectNamePda,
      subjectState: subjectStatePda,
      mint: mintPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction()

  // ix2: buy_shares(1) — creator buys the first key
  const ix2 = await program.methods
    .buyShares(new BN(1))
    .accounts({
      buyer: creator,
      subjectName: subjectNamePda,
      subject: creator,
      config: getConfigPda(),
      feeDestination,
      royaltyWallet: creator,
      subjectState: subjectStatePda,
      mint: mintPda,
      buyerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction()

  const tx = new Transaction().add(ix1, ix2)
  return (program.provider as AnchorProvider).sendAndConfirm(tx)
}

export async function buyShares(
  program: AnyProgram,
  name: string,
  amount: number,
  creatorWallet: PublicKey,
  feeDestination: PublicKey,
  royaltyWallet: PublicKey,
): Promise<string> {
  const buyer = (program.provider as AnchorProvider).wallet.publicKey
  const subjectNamePda = getSubjectNamePda(name)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const mintPda = getMintPda(subjectNamePda)
  const buyerAta = getAssociatedTokenAddressSync(mintPda, buyer)

  return program.methods
    .buyShares(new BN(amount))
    .accounts({
      buyer,
      subjectName: subjectNamePda,
      subject: creatorWallet,
      config: getConfigPda(),
      feeDestination,
      royaltyWallet,
      subjectState: subjectStatePda,
      mint: mintPda,
      buyerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
}

export async function sellShares(
  program: AnyProgram,
  name: string,
  amount: number,
  creatorWallet: PublicKey,
  feeDestination: PublicKey,
  royaltyWallet: PublicKey,
): Promise<string> {
  const seller = (program.provider as AnchorProvider).wallet.publicKey
  const subjectNamePda = getSubjectNamePda(name)
  const subjectStatePda = getSubjectStatePda(subjectNamePda)
  const mintPda = getMintPda(subjectNamePda)
  const sellerAta = getAssociatedTokenAddressSync(mintPda, seller)

  return program.methods
    .sellShares(new BN(amount))
    .accounts({
      seller,
      subjectName: subjectNamePda,
      subject: creatorWallet,
      config: getConfigPda(),
      feeDestination,
      royaltyWallet,
      subjectState: subjectStatePda,
      mint: mintPda,
      sellerAta,
      cooldownState: getCooldownPda(subjectNamePda, seller),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
}
