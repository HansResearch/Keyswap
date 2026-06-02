import pkg from '@coral-xyz/anchor'
const { Program, AnchorProvider, BN, Wallet } = pkg
import { Connection, PublicKey, SystemProgram, Keypair } from '@solana/web3.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'

const PROGRAM_ID = new PublicKey('Cxf5ZrXGR7DyojacpeN6TygQqxv8j4xRmcHwetyH7YNj')
const RPC = 'https://api.devnet.solana.com'

const IDL = {
  version: '0.1.0', name: 'friendtech_shares',
  instructions: [{
    name: 'initializeProtocol',
    accounts: [
      { name: 'authority', isMut: true, isSigner: true },
      { name: 'config', isMut: true, isSigner: false },
      { name: 'systemProgram', isMut: false, isSigner: false },
    ],
    args: [
      { name: 'protocolFeePercent', type: 'u64' },
      { name: 'subjectFeePercent', type: 'u64' },
    ],
  }],
  accounts: [{
    name: 'ProtocolConfig',
    type: { kind: 'struct', fields: [
      { name: 'authority', type: 'publicKey' },
      { name: 'feeDestination', type: 'publicKey' },
      { name: 'burnDestination', type: 'publicKey' },
      { name: 'protocolFeePercent', type: 'u64' },
      { name: 'subjectFeePercent', type: 'u64' },
      { name: 'bump', type: 'u8' },
    ]},
  }],
  events: [], errors: [],
}

const raw = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))
const keypair = Keypair.fromSecretKey(Uint8Array.from(raw))

const connection = new Connection(RPC, 'confirmed')
const wallet = new Wallet(keypair)
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
const program = new Program(IDL, PROGRAM_ID, provider)

const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)
console.log('Config PDA:', configPda.toBase58())

const sig = await program.methods
  .initializeProtocol(new BN(50_000_000), new BN(50_000_000))
  .accounts({
    authority: keypair.publicKey,
    config: configPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc()

console.log('Protocol initialized! Tx:', sig)
console.log('Fee destination:', keypair.publicKey.toBase58())
