import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { useMemo } from 'react'

// Same source of truth as src/lib/program.ts — set via VITE_RPC_URL
import { RPC_URL } from './program'
const ENDPOINT = RPC_URL

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  // Phantom-only. Wallets auto-discovered via Wallet Standard (Solflare/Metamask
  // /Leap, etc.) still appear in the WalletProvider's wallet list — they're
  // filtered out in the Header's selection UI.
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )
}
