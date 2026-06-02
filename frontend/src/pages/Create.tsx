import { useState, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '@solana/wallet-adapter-react'
import {
  getProgram,
  createKeyAndBuy,
  fetchConfig,
  fetchSubjectStateByName,
  decodeName,
} from '../program'
import { getBuyPrice, fmtSol } from '../pricing'
import { navigate } from '../App'
import { saveCreator, getPfp } from './Home'
import { uploadPfp, registerKey } from '../api'
import { getSubjectNamePda } from '../program'

const NAME_RE = /^[a-z0-9]{3,32}$/

export default function Create() {
  const { publicKey, wallet, signTransaction, signAllTransactions } = useWallet()
  const { connection } = useConnection()

  const [name, setName] = useState('')
  const [pfpFile, setPfpFile] = useState<File | null>(null)
  const [pfpPreview, setPfpPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const nameValid = NAME_RE.test(name)
  const firstKeyPrice = getBuyPrice(0, 1)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPfpFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPfpPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function handleCreate() {
    if (!publicKey || !wallet) { setErr('Connect your wallet first.'); return }
    if (!nameValid) { setErr('Name must be 3-32 lowercase letters/digits.'); return }

    const program = getProgram(
      { publicKey, signTransaction, signAllTransactions },
      connection,
    )

    setLoading(true)
    setErr('')

    try {
      const config = await fetchConfig(program)
      if (!config) { setErr('Protocol not initialized.'); setLoading(false); return }

      await createKeyAndBuy(program, name, config.feeDestination)

      // Register key in backend immediately (Helius webhook may lag)
      const subjectNamePda = getSubjectNamePda(name)
      registerKey({
        name,
        creatorWallet: publicKey.toBase58(),
        subjectNamePda: subjectNamePda.toBase58(),
      }).catch(() => {/* non-fatal */})

      // Upload PFP — try API first, fall back to localStorage
      let pfpUrl: string | null = null
      if (pfpFile) {
        try {
          pfpUrl = await uploadPfp(name, pfpFile)
        } catch {
          // API unavailable — store locally as fallback
          if (pfpPreview) {
            localStorage.setItem(`keytech_pfp_${name}`, pfpPreview)
            pfpUrl = pfpPreview
          }
        }
      }

      const state = await fetchSubjectStateByName(program, name)
      saveCreator({
        name,
        creatorWallet: publicKey.toBase58(),
        pfp: pfpUrl ?? getPfp(name),
        supply: state ? state.supply.toNumber() : 1,
        priceFloor: state ? state.priceFloor.toNumber() : 0,
      })

      navigate(`#/key/${name}`)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="back" onClick={() => navigate('#/')}>← back</div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 16, fontWeight: 'bold', letterSpacing: 2, marginBottom: 4 }}>
          CREATE YOUR KEY
        </div>
        <div className="dim" style={{ fontSize: 11 }}>1 transaction — approve once</div>
      </div>

      {/* Name */}
      <div className="form-group">
        <label className="label">Handle</label>
        <input
          className="input"
          placeholder="e.g. satoshi"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          maxLength={32}
          disabled={loading}
        />
        <div className="hint">
          {name.length}/32 &nbsp;·&nbsp; lowercase letters and digits only
          {name.length >= 3 && !nameValid && (
            <span style={{ color: '#f55' }}> — invalid chars</span>
          )}
          {nameValid && <span style={{ color: '#8f8' }}> ✓</span>}
        </div>
      </div>

      {/* PFP */}
      <div className="form-group">
        <label className="label">Profile picture (optional)</label>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        <div className="pfp-preview" onClick={() => !loading && fileRef.current?.click()}>
          {pfpPreview ? <img src={pfpPreview} alt="pfp" /> : 'click to upload'}
        </div>
        <div className="hint">Uploaded to CDN — visible to everyone</div>
      </div>

      {/* Cost estimate */}
      <div style={{ border: '1px solid #222', padding: 14, marginBottom: 20, fontSize: 12 }}>
        <div className="dim" style={{ fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>ESTIMATED COST</div>
        <div>First key price: <strong>{fmtSol(firstKeyPrice)}</strong></div>
        <div className="dim" style={{ marginTop: 4 }}>+ protocol fees + rent (~0.005 SOL)</div>
      </div>

      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <button
        className="btn btn-solid"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={handleCreate}
        disabled={!publicKey || !nameValid || loading}
      >
        {loading
          ? 'Creating…'
          : !publicKey
          ? 'Connect wallet first'
          : 'Create & Buy First Key'}
      </button>
    </>
  )
}
