import { PublicKey } from '@solana/web3.js'

export const PROGRAM_ID = new PublicKey('Cxf5ZrXGR7DyojacpeN6TygQqxv8j4xRmcHwetyH7YNj')
export const RPC_URL = 'https://api.devnet.solana.com'
export const EXPLORER_TX = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`
export const EXPLORER_ADDR = (addr: string) =>
  `https://explorer.solana.com/address/${addr}?cluster=devnet`
export const AUTHORITY = new PublicKey('5i4RA1qCbYWRCcuEtWd3cyRrrQBLdWivBttiYqrX5wqW')

// 5% protocol fee, 5% subject fee (in 1e9 units)
export const DEFAULT_PROTOCOL_FEE = 50_000_000
export const DEFAULT_SUBJECT_FEE = 50_000_000
