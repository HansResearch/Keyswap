import { Buffer } from 'buffer'

// @solana/web3.js and @coral-xyz/anchor expect Buffer + global to exist in the browser.
// This must run before any Solana imports are evaluated.
if (typeof globalThis.Buffer === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Buffer = Buffer
}
if (typeof globalThis.global === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).global = globalThis
}
