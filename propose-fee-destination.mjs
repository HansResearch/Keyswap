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
const RPC        = process.env.SOLANA_RPC ?? (() => { throw new Error('Set SOLANA_RPC env var') })()

// Anchor discriminator for `propose_fee_destination` (sha256("global:propose_fee_destination").slice(0,8))
const DISC = Buffer.from([98, 216, 232, 3, 17, 106, 232, 107])

// Load deployer wallet (current config.authority)
const keypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(
  readFileSync(`${process.env.HOME}/.config/solana/keyswap-mainnet-deployer.json`, 'utf8')
)))

const NEW_FEE_DESTINATION = new PublicKey('7tCw4v1YbUnimBnwubQofSvHrQ74HbPRg11nSSbgPBxi')

const [configPda]      = PublicKey.findProgramAddressSync([Buffer.from('config')],            PROGRAM_ID)
const [proposalPda]    = PublicKey.findProgramAddressSync([Buffer.from('fee_dest_proposal')], PROGRAM_ID)

console.log('Authority (deployer):', keypair.publicKey.toBase58())
console.log('Config PDA:          ', configPda.toBase58())
console.log('Proposal PDA:        ', proposalPda.toBase58())
console.log('New fee destination: ', NEW_FEE_DESTINATION.toBase58())

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: keypair.publicKey,       isSigner: true,  isWritable: true  }, // authority
    { pubkey: configPda,               isSigner: false, isWritable: false }, // config
    { pubkey: NEW_FEE_DESTINATION,     isSigner: false, isWritable: false }, // new_destination
    { pubkey: proposalPda,             isSigner: false, isWritable: true  }, // fee_dest_proposal (init_if_needed)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ],
  data: DISC, // no args
})

const conn = new Connection(RPC, 'confirmed')
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
const tx = new Transaction()
tx.recentBlockhash = blockhash
tx.feePayer = keypair.publicKey
tx.add(ix)
tx.sign(keypair)

console.log('\nSending propose_fee_destination...')
try {
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  console.log('✅ Done! Signature:', sig)
  console.log(`Explorer: https://solscan.io/tx/${sig}`)
} catch (e) {
  if (e.logs) console.error('Logs:\n', e.logs.join('\n'))
  throw e
}
