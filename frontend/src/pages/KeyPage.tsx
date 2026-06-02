import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import {
  getProgram,
  fetchSubjectStateByName,
  fetchConfig,
  fetchHolderBalance,
  fetchHistory,
  buyShares,
  sellShares,
  decodeName,
  shortAddr,
  getSubjectNamePda,
  TxRecord,
} from '../program'
import { getBuyPrice, getSellPrice, maxSellAmount, fmtSol, getMarketCap } from '../pricing'
import { navigate } from '../App'
import { saveCreator, getPfp } from './Home'
import { EXPLORER_TX } from '../constants'
import { fetchKey, type ApiTrade } from '../api'

type Tab = 'buy' | 'sell'

type KeyInfo = {
  name: string
  creatorWallet: PublicKey
  supply: number
  priceFloor: number
  royaltyWallet: PublicKey
  royaltyPercent: number
}

function fmtTime(ts: number | string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type DisplayTrade = {
  sig: string
  type: 'BUY' | 'SELL' | 'CREATE' | 'OTHER'
  time: number | string | null | undefined
  err: boolean
}

function fromApiTrade(t: ApiTrade): DisplayTrade {
  return { sig: t.tx_sig, type: t.trade_type, time: t.block_time, err: false }
}

function fromTxRecord(t: TxRecord): DisplayTrade {
  return { sig: t.sig, type: t.type, time: t.blockTime, err: t.err }
}

export default function KeyPage({ name }: { name: string }) {
  const { publicKey, wallet, signTransaction, signAllTransactions } = useWallet()
  const { connection } = useConnection()

  const [info, setInfo] = useState<KeyInfo | null>(null)
  const [held, setHeld] = useState(0)
  const [trades, setTrades] = useState<DisplayTrade[]>([])
  const [tab, setTab] = useState<Tab>('buy')
  const [amount, setAmount] = useState(1)
  const [loading, setLoading] = useState(false)
  const [txErr, setTxErr] = useState('')
  const [lastTx, setLastTx] = useState('')
  const [notFound, setNotFound] = useState(false)

  const subjectNamePda = getSubjectNamePda(name)
  const pfp = getPfp(name)

  const program = publicKey && wallet
    ? getProgram({ publicKey, signTransaction, signAllTransactions }, connection)
    : null

  const load = useCallback(async () => {
    const readProgram = getProgram(
      { publicKey: PublicKey.default, signTransaction: null, signAllTransactions: null },
      connection,
    ) as any

    const state = await fetchSubjectStateByName(readProgram, name)
    if (!state) { setNotFound(true); return }

    const decoded: KeyInfo = {
      name: decodeName(state.name),
      creatorWallet: state.subject,
      supply: state.supply.toNumber(),
      priceFloor: state.priceFloor.toNumber(),
      royaltyWallet: state.royaltyWallet,
      royaltyPercent: state.royaltyPercent.toNumber(),
    }
    setInfo(decoded)

    saveCreator({
      name: decoded.name,
      creatorWallet: state.subject.toBase58(),
      pfp: getPfp(name),
      supply: decoded.supply,
      priceFloor: decoded.priceFloor,
    })

    if (publicKey) {
      const bal = await fetchHolderBalance(connection, subjectNamePda, publicKey)
      setHeld(bal)
    }

    // Try API first, fall back to on-chain signatures
    try {
      const { trades: apiTrades } = await fetchKey(name)
      if (apiTrades.length > 0) {
        setTrades(apiTrades.map(fromApiTrade))
        return
      }
    } catch {}

    const hist = await fetchHistory(connection, subjectNamePda)
    setTrades(hist.map(fromTxRecord))
  }, [name, connection, publicKey, subjectNamePda])

  useEffect(() => { load() }, [load])

  const buyPrice  = info ? getBuyPrice(info.supply, amount) : 0
  const sellPrice = info ? getSellPrice(info.supply, Math.min(amount, held)) : 0
  const maxSell   = info ? maxSellAmount(info.supply) : 1
  const canSell   = held > 0 && info && info.supply > 1
  const isOwn     = publicKey && info ? publicKey.toBase58() === info.creatorWallet.toBase58() : false

  async function handleTrade() {
    if (!program || !info) return
    setLoading(true)
    setTxErr('')
    setLastTx('')
    try {
      const config = await fetchConfig(program)
      if (!config) { setTxErr('Protocol not initialized'); setLoading(false); return }
      const feeDest = config.feeDestination
      const royalty = info.royaltyPercent > 0 ? info.royaltyWallet : info.creatorWallet

      let sig: string
      if (tab === 'buy') {
        sig = await buyShares(program, name, amount, info.creatorWallet, feeDest, royalty)
      } else {
        const sellAmt = Math.min(amount, held, maxSell)
        sig = await sellShares(program, name, sellAmt, info.creatorWallet, feeDest, royalty)
      }
      setLastTx(sig)
      await load()
    } catch (e: any) {
      const msg: string = e?.message || String(e)
      if (msg.includes('SellCooldown')) setTxErr('Sell cooldown active (~60s between large sells)')
      else if (msg.includes('ExceedsSellLimit')) setTxErr(`Max sell per tx: ${maxSell} keys`)
      else if (msg.includes('CannotSellLastShare')) setTxErr('Cannot sell the last share')
      else if (msg.includes('OnlySubjectCanBuyFirst')) setTxErr('Only the creator can buy the first key')
      else setTxErr(msg)
    } finally {
      setLoading(false)
    }
  }

  if (notFound) return (
    <>
      <div className="back" onClick={() => navigate('#/')}>← back</div>
      <div className="empty">Key "{name}" not found.</div>
    </>
  )

  if (!info) return (
    <>
      <div className="back" onClick={() => navigate('#/')}>← back</div>
      <div className="dim" style={{ fontSize: 12 }}>Loading…</div>
    </>
  )

  return (
    <>
      <div className="back" onClick={() => navigate('#/')}>← back</div>

      {/* Header */}
      <div className="key-header">
        <div className="key-avatar">
          {pfp ? <img src={pfp} alt="" /> : info.name[0].toUpperCase()}
        </div>
        <div>
          <div className="key-name">{info.name.toUpperCase()}</div>
          <div className="key-addr">
            by&nbsp;
            <a href={`https://explorer.solana.com/address/${info.creatorWallet.toBase58()}?cluster=devnet`}
              target="_blank" rel="noreferrer">
              {shortAddr(info.creatorWallet.toBase58())}
            </a>
            {isOwn && <span style={{ marginLeft: 8, color: '#555', fontSize: 10 }}>YOU</span>}
          </div>
          <div className="key-stats">
            <span><strong>{info.supply}</strong>supply</span>
            <span><strong>{fmtSol(getMarketCap(info.supply))}</strong>market cap</span>
            <span><strong>{fmtSol(getBuyPrice(info.supply, 1))}</strong>next price</span>
          </div>
        </div>
      </div>

      {/* Trade */}
      <div className="trade-panel">
        <div className="trade-tabs">
          <button className={`trade-tab${tab === 'buy' ? ' active' : ''}`}
            onClick={() => { setTab('buy'); setAmount(1); setTxErr(''); setLastTx('') }}>
            BUY
          </button>
          <button className={`trade-tab${tab === 'sell' ? ' active' : ''}`}
            onClick={() => { setTab('sell'); setAmount(1); setTxErr(''); setLastTx('') }}>
            SELL
          </button>
        </div>

        <div className="trade-row">
          <span className="dim" style={{ fontSize: 11 }}>AMOUNT</span>
          <input type="number" className="input-inline"
            min={1} max={tab === 'sell' ? Math.min(held, maxSell) : 999}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) | 0))} />
          <span className="dim" style={{ fontSize: 11 }}>key{amount !== 1 ? 's' : ''}</span>
        </div>

        <div className="trade-price">
          {tab === 'buy'
            ? <>Cost: <strong>{fmtSol(buyPrice)}</strong> + ~5% fees</>
            : <>You receive: <strong>{fmtSol(sellPrice)}</strong> (after fees)</>}
        </div>

        <button
          className={`btn${tab === 'buy' ? ' btn-solid' : ' btn-sell'}`}
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={handleTrade}
          disabled={loading || !publicKey || (tab === 'sell' && (!canSell || held === 0))}>
          {loading ? 'Waiting for wallet…'
            : !publicKey ? 'Connect wallet'
            : tab === 'buy' ? `Buy ${amount} key${amount !== 1 ? 's' : ''}`
            : held === 0 ? 'You hold 0 keys'
            : `Sell ${Math.min(amount, held, maxSell)} key${amount !== 1 ? 's' : ''}`}
        </button>

        {txErr && <div className="err mt8">{txErr}</div>}

        {lastTx && (
          <div style={{ marginTop: 10, fontSize: 11 }}>
            <span style={{ color: '#8f8' }}>✓ </span>
            <a href={EXPLORER_TX(lastTx)} target="_blank" rel="noreferrer"
              style={{ color: '#8f8', textDecoration: 'underline' }}>
              View transaction ↗
            </a>
          </div>
        )}

        <div className="hold-info">
          You hold: <strong>{held}</strong> key{held !== 1 ? 's' : ''}
          {tab === 'sell' && held > 0 && (
            <span className="dim"> &nbsp;·&nbsp; max sell: {maxSell}/tx</span>
          )}
        </div>
      </div>

      {/* History */}
      <div className="section-title">HISTORY</div>
      {trades.length === 0 ? (
        <div className="empty">No transactions yet</div>
      ) : (
        trades.map((tx) => {
          const badgeClass = tx.type === 'BUY' ? 'badge-buy' : tx.type === 'SELL' ? 'badge-sell' : 'badge-other'
          const label = tx.type === 'BUY' ? 'BUY' : tx.type === 'SELL' ? 'SELL' : tx.type === 'CREATE' ? 'CREATE' : '···'
          return (
            <div key={tx.sig} className="history-row">
              <span className={`badge ${badgeClass}`}>{label}</span>
              <span className="history-sig">{tx.sig.slice(0, 20)}…</span>
              <span className="history-time">{fmtTime(tx.time)}</span>
              {tx.err && <span style={{ color: '#f55', fontSize: 10 }}>FAIL</span>}
              <a className="history-link" href={EXPLORER_TX(tx.sig)} target="_blank" rel="noreferrer">↗</a>
            </div>
          )
        })
      )}
    </>
  )
}
