import { readFileSync } from 'fs'
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID ?? (() => { throw new Error('Set PROGRAM_ID env var') })())
const RPC        = process.env.SOLANA_RPC ?? (() => { throw new Error('Set SOLANA_RPC env var') })()

// Discriminator for `apply_fee_destination`
const DISC = Buffer.from([134, 197, 209, 20, 132, 72, 11, 161])

const keypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(
  readFileSync(`${process.env.HOME}/.config/solana/keyswap-mainnet-deployer.json`, 'utf8')
)))

const [configPda]   = PublicKey.findProgramAddressSync([Buffer.from('config')],            PROGRAM_ID)
const [proposalPda] = PublicKey.findProgramAddressSync([Buffer.from('fee_dest_proposal')], PROGRAM_ID)

console.log('Authority:    ', keypair.publicKey.toBase58())
console.log('Config PDA:   ', configPda.toBase58())
console.log('Proposal PDA: ', proposalPda.toBase58())

const conn = new Connection(RPC, 'confirmed')

// Show pending value + timelock status
const info = await conn.getAccountInfo(proposalPda)
if (!info) { console.error('❌ No proposal exists — nothing to apply'); process.exit(1) }
const pending = new PublicKey(info.data.slice(8, 40)).toBase58()
const applyAfter = Number(info.data.readBigInt64LE(40))
const now = Math.floor(Date.now() / 1000)
console.log('\nPending new destination:', pending)
console.log('apply_after:', new Date(applyAfter * 1000).toString())
if (now < applyAfter) {
  const hoursLeft = (applyAfter - now) / 3600
  console.error(`❌ Timelock not yet elapsed. Wait another ${hoursLeft.toFixed(2)} hours.`)
  process.exit(1)
}
console.log('✓ Timelock elapsed — proceeding to apply')

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: keypair.publicKey, isSigner: true,  isWritable: true  }, // authority
    { pubkey: configPda,         isSigner: false, isWritable: true  }, // config (mut)
    { pubkey: proposalPda,       isSigner: false, isWritable: true  }, // fee_dest_proposal (close=authority)
  ],
  data: DISC,
})

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
const tx = new Transaction()
tx.recentBlockhash = blockhash
tx.feePayer = keypair.publicKey
tx.add(ix)
tx.sign(keypair)

console.log('\nSending apply_fee_destination...')
try {
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  console.log('✅ Applied! Signature:', sig)
  console.log(`Explorer: https://solscan.io/tx/${sig}`)
  console.log(`\nNew fee destination is now LIVE: ${pending}`)
} catch (e) {
  if (e.logs) console.error('Logs:\n', e.logs.join('\n'))
  throw e
}
