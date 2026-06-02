import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import {
  getProgram,
  fetchSubjectStateByName,
  decodeName,
  initializeProtocol,
  getConfigPda,
} from '../program'
import { fmtSol, getMarketCap } from '../pricing'
import { navigate } from '../App'
import { AUTHORITY } from '../constants'
import { fetchKeys, type ApiKey } from '../api'

export type Creator = {
  name: string
  creatorWallet: string
  pfp: string | null
  supply: number
  priceFloor: number
}

const LS_KEY = 'keytech_creators_v2'

function loadCreators(): Creator[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}

export function saveCreator(c: Creator) {
  const list = loadCreators()
  const idx = list.findIndex((x) => x.name === c.name)
  if (idx >= 0) list[idx] = c
  else list.unshift(c)
  localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 50)))
}

export function getPfp(name: string): string | null {
  return localStorage.getItem(`keytech_pfp_${name}`)
}

function apiKeyToCreator(k: ApiKey): Creator {
  return {
    name: k.name,
    creatorWallet: k.creator_wallet,
    pfp: k.pfp_url,
    supply: k.supply,
    priceFloor: k.price_floor,
  }
}

export default function Home() {
  const { publicKey, wallet, signTransaction, signAllTransactions } = useWallet()
  const { connection } = useConnection()
  const [creators, setCreators] = useState<Creator[]>(loadCreators)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState('')
  const [configExists, setConfigExists] = useState<boolean | null>(null)
  const [initLoading, setInitLoading] = useState(false)
  const [initErr, setInitErr] = useState('')

  // Load from API on mount
  useEffect(() => {
    fetchKeys().then((keys) => {
      if (keys.length > 0) {
        const from_api = keys.map(apiKeyToCreator)
        setCreators(from_api)
        from_api.forEach(saveCreator)
      }
    }).catch(() => {/* fall back to localStorage */})
  }, [])

  useEffect(() => {
    connection.getAccountInfo(getConfigPda())
      .then((info) => setConfigExists(info !== null))
      .catch(() => setConfigExists(false))
  }, [connection])

  const isAuthority = publicKey?.toBase58() === AUTHORITY.toBase58()

  const program = publicKey && wallet
    ? getProgram({ publicKey, signTransaction, signAllTransactions }, connection)
    : null

  async function handleInitProtocol() {
    if (!program) return
    setInitLoading(true)
    setInitErr('')
    try {
      await initializeProtocol(program)
      setConfigExists(true)
    } catch (e: any) {
      setInitErr(e.message || String(e))
    } finally {
      setInitLoading(false)
    }
  }

  async function handleSearch() {
    const query = search.trim().toLowerCase()
    if (!query) return
    setSearching(true)
    setSearchErr('')
    try {
      const readProgram = getProgram(
        { publicKey: PublicKey.default, signTransaction: null, signAllTransactions: null },
        connection,
      ) as any
      const state = await fetchSubjectStateByName(readProgram, query)
      if (!state) { setSearchErr(`No key found for name "${query}"`); return }
      const name = decodeName(state.name)
      saveCreator({
        name,
        creatorWallet: state.subject.toBase58(),
        pfp: getPfp(name),
        supply: state.supply.toNumber(),
        priceFloor: state.priceFloor.toNumber(),
      })
      setCreators(loadCreators())
      navigate(`#/key/${name}`)
    } catch (e: any) {
      setSearchErr(e.message || String(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      {isAuthority && configExists === false && (
        <div style={{ border: '1px solid #555', padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>ADMIN — Protocol not initialized</div>
          <button className="btn btn-solid" onClick={handleInitProtocol} disabled={initLoading}>
            {initLoading ? 'Initializing…' : 'Initialize Protocol (5% / 5% fees)'}
          </button>
          {initErr && <div className="err">{initErr}</div>}
        </div>
      )}

      <div className="search-row">
        <input
          className="input"
          placeholder="Search by name (e.g. tokyo)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn" onClick={handleSearch} disabled={searching}>
          {searching ? '…' : 'GO'}
        </button>
      </div>
      {searchErr && <div className="err" style={{ marginBottom: 12 }}>{searchErr}</div>}

      {creators.length === 0 ? (
        <div className="empty">
          {publicKey
            ? 'No keys yet. Create yours or search by name.'
            : 'Connect your wallet to get started.'}
        </div>
      ) : (
        creators.map((c) => (
          <div key={c.name} className="card" onClick={() => navigate(`#/key/${c.name}`)}>
            <div className="avatar">
              {c.pfp ? <img src={c.pfp} alt="" /> : c.name[0].toUpperCase()}
            </div>
            <div className="card-info">
              <div className="card-name">{c.name}</div>
              <div className="card-meta">
                Supply: {c.supply} &nbsp;·&nbsp; MCAP: {fmtSol(getMarketCap(c.supply))}
              </div>
            </div>
            <div style={{ color: '#555', fontSize: 16 }}>›</div>
          </div>
        ))
      )}
    </>
  )
}
