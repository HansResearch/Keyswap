import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import Home from './pages/Home'
import Create from './pages/Create'
import KeyPage from './pages/KeyPage'

function parseHash(hash: string): { page: string; param?: string } {
  if (hash.startsWith('#/key/')) return { page: 'key', param: hash.slice(6) }
  if (hash === '#/create') return { page: 'create' }
  return { page: 'home' }
}

export function navigate(path: string) {
  window.location.hash = path
}

export default function App() {
  const { publicKey } = useWallet()
  const [hash, setHash] = useState(window.location.hash || '#/')

  useEffect(() => {
    const handler = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const { page, param } = parseHash(hash)

  return (
    <div className="shell">
      <div className="topbar">
        <span className="logo" onClick={() => navigate('#/')}>KEYTECH</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {publicKey && page !== 'create' && (
            <button className="btn btn-sm" onClick={() => navigate('#/create')}>
              + CREATE KEY
            </button>
          )}
          <WalletMultiButton />
        </div>
      </div>

      {page === 'key' && param ? (
        <KeyPage name={param} />
      ) : page === 'create' ? (
        <Create />
      ) : (
        <Home />
      )}
    </div>
  )
}
