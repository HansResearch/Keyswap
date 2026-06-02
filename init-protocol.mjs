import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? (() => { throw new Error('Set PROGRAM_ID env var') })())
const RPC        = process.env.SOLANA_RPC ?? (() => { throw new Error('Set SOLANA_RPC env var (e.g. your Helius mainnet URL)') })()

// Load deployer wallet (mainnet)
const keypairFile = readFileSync(`${process.env.HOME}/.config/solana/keyswap-mainnet-deployer.json`, 'utf8')
const keypair     = Keypair.fromSecretKey(Buffer.from(JSON.parse(keypairFile)))

// Derive config PDA
const [configPda, configBump] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)
console.log('Config PDA:', configPda.toBase58())
console.log('Deployer:  ', keypair.publicKey.toBase58())

// Anchor discriminator: sha256("global:initialize_protocol")[0..8]
function disc(name) {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8)
}

function encodeU64(v) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(v))
  return b
}

// initialize_protocol(protocol_fee_percent=20_000_000 = 2%, subject_fee_percent=10_000_000 = 1%)
const PROTOCOL_FEE = 20_000_000   // 2%
const SUBJECT_FEE  = 10_000_000   // 1% (creator / key launcher cut)

const data = Buffer.concat([
  disc('initialize_protocol'),
  encodeU64(PROTOCOL_FEE),
  encodeU64(SUBJECT_FEE),
])

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: keypair.publicKey, isSigner: true,  isWritable: true  }, // authority
    { pubkey: configPda,         isSigner: false, isWritable: true  }, // config (init)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
})

const connection = new Connection(RPC, 'confirmed')

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
const tx = new Transaction()
tx.recentBlockhash = blockhash
tx.feePayer = keypair.publicKey
tx.add(ix)
tx.sign(keypair)

console.log('Sending initialize_protocol...')
try {
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  console.log('Done! Signature:', sig)
  console.log(`Explorer: https://explorer.solana.com/tx/${sig}`)
} catch (e) {
  if (e.logs) console.error('Logs:\n', e.logs.join('\n'))
  throw e
}
