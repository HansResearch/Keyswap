import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useConnection } from '@solana/wallet-adapter-react'
import { getBuyPrice, getMarketCap, fmtSol, fmtUsd } from '@/lib/pricing'
import { registerKey, uploadPfp, updateKeySocials } from '@/lib/api'
import { toast } from 'sonner'
import {
  fetchConfig,
  getSubjectNamePda,
  prepareCreateKeyAndBuyTransaction,
  prefetchTradeContext,
  signAndSendPrepared,
  type PreparedTransaction,
} from '@/lib/program'

export const Route = createFileRoute('/launch')({
  component: LaunchPage,
})

const NAME_RE = /^[a-z0-9]{3,32}$/
const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const CREATOR_MIN_FIRST_BUY = 3
const CREATOR_MAX_FIRST_BUY = 10

function LaunchPage() {
  const navigate = useNavigate()
  const { publicKey, wallet, connected, connecting, signTransaction, sendTransaction } = useWallet()
  const { connection } = useConnection()

  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameChecking, setNameChecking] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [initialBuy, setInitialBuy] = useState(5)
  const [xUrl, setXUrl] = useState('')
  const [telegramUrl, setTelegramUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [commUrl, setCommUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preparedTx, setPreparedTx] = useState<PreparedTransaction | null>(null)
  const [preparingTx, setPreparingTx] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nameFormatValid = NAME_RE.test(name)
  const estimatedCost   = nameFormatValid ? getBuyPrice(0, initialBuy) : 0
  const startingMc      = nameFormatValid ? getMarketCap(initialBuy) : 0
  // Button is enabled as soon as the form is valid — pre-prepare is just an
  // optimization for fast wallet popup. If the pre-prepare failed (e.g. RPC was
  // rate-limited), the submit handler falls back to preparing on the fly.
  const canSubmit = connected && nameFormatValid && !nameError && !nameChecking && !fileError && !busy

  useEffect(() => {
    if (!connected) return
    let cancelled = false

    async function warmLaunchContext() {
      if (!cancelled) prefetchTradeContext(connection)
    }

    warmLaunchContext()
    const timer = window.setInterval(warmLaunchContext, 20_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connected, connection])

  useEffect(() => {
    let cancelled = false

    async function prepareLaunchTx() {
      // Bail early — clear BOTH flags so we never get stuck showing "Preparing…"
      // (e.g. name became invalid while a previous prepare was in-flight).
      if (!connected || !publicKey || !nameFormatValid || nameError || nameChecking) {
        setPreparedTx(null)
        setPreparingTx(false)
        return
      }

      setPreparedTx(null)
      setPreparingTx(true)
      try {
        const config = await fetchConfig(connection)
        if (!config || cancelled) return
        const prepared = await prepareCreateKeyAndBuyTransaction(
          connection,
          publicKey,
          name,
          config.feeDestination,
          initialBuy,
          { skipNameCheck: true },
        )
        if (!cancelled) setPreparedTx(prepared)
      } catch {
        if (!cancelled) setPreparedTx(null)
      } finally {
        if (!cancelled) setPreparingTx(false)
      }
    }

    prepareLaunchTx()
    const timer = window.setInterval(prepareLaunchTx, 20_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connected, connection, initialBuy, name, nameError, nameChecking, nameFormatValid, publicKey])

  // ── Image validation (immediate, client-side) ─────────────────────────────
  const handleFile = (f: File | null) => {
    setFileError(null)
    if (!f) { setFile(null); setPreview(null); return }

    if (!ALLOWED_TYPES.includes(f.type)) {
      setFileError('Only JPEG, PNG, WebP or GIF allowed')
      return
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setFileError(`Image too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB.`)
      return
    }

    setFile(f)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(f)
  }

  // ── Name availability check (debounced, before any signing) ───────────────
  const handleNameChange = (raw: string) => {
    const val = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
    setName(val)
    setNameError(null)
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current)

    if (!NAME_RE.test(val)) return

    setNameChecking(true)
    nameCheckTimer.current = setTimeout(async () => {
      try {
        const pda = getSubjectNamePda(val)
        const info = await connection.getAccountInfo(pda)
        if (info) setNameError(`"${val}" is already taken`)
        else setNameError(null)
      } catch {
        setNameError(null) // fail open — let the tx catch it
      } finally {
        setNameChecking(false)
      }
    }, 600)
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!connected || !publicKey || !wallet) { setError('Connect your wallet first'); return }
    if (!nameFormatValid) { setError('Name must be 3-32 lowercase letters/digits'); return }
    if (nameError) { setError(nameError); return }
    if (fileError) { setError(fileError); return }

    setError(null)
    setBusy(true)
    try {
      const walletAdapter = { publicKey: publicKey!, signTransaction: signTransaction!, sendTransaction }

      // Fast path: use the pre-prepared tx if it's ready. Slow path: prepare now.
      // The slow path covers the case where pre-prepare failed (RPC rate-limited,
      // network glitch) — without it the user would be stuck on "Preparing…" forever.
      let txToSend = preparedTx
      if (!txToSend) {
        const config = await fetchConfig(connection)
        if (!config) throw new Error('Could not reach Solana — please check your connection and try again')
        txToSend = await prepareCreateKeyAndBuyTransaction(
          connection,
          publicKey,
          name,
          config.feeDestination,
          initialBuy,
          { skipNameCheck: true },
        )
      }
      await signAndSendPrepared(connection, walletAdapter, txToSend)

      const subjectNamePda = getSubjectNamePda(name)
      await registerKey({ name, creatorWallet: publicKey.toBase58(), subjectNamePda: subjectNamePda.toBase58() })

      if (file) {
        const url = await uploadPfp(name, file)
        if (!url) throw new Error('Image upload failed — please try again from your key page')
      }

      const hasSocials = xUrl || telegramUrl || websiteUrl || commUrl
      if (hasSocials) {
        await updateKeySocials(name, {
          x_url: xUrl.trim() || null,
          telegram_url: telegramUrl.trim() || null,
          website_url: websiteUrl.trim() || null,
          comm_url: commUrl.trim() || null,
        })
      }

      toast.success(`Launched "${name}" — your key is live!`)
      navigate({ to: '/k/$keyId', params: { keyId: name } })
    } catch (e: any) {
      const msg = e?.message ?? 'Transaction failed'
      setError(msg)
      toast.error(`Launch failed: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-6">
          <Link to="/" className="text-mono-xs text-primary hover:underline">← Market</Link>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 sm:p-6">
          <div className="mb-6">
            <h1 className="text-lg font-bold">Launch a Key</h1>
            <p className="mt-1 text-mono-xs text-muted-foreground">
              All checks happen before you sign — your wallet opens only when everything is ready.
            </p>
          </div>

          {!connected && !connecting && (
            <div className="mb-6 rounded-md border border-border bg-background p-4 text-center">
              <p className="text-mono-xs text-muted-foreground">Connect your wallet to continue</p>
            </div>
          )}

          <div className="space-y-5">
            {/* PFP */}
            <div>
              <label className="text-mono-xs text-muted-foreground">Profile Image <span className="text-muted-foreground/50">(optional · max 2 MB · JPEG/PNG/WebP/GIF)</span></label>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!isDragging) setIsDragging(true) }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) handleFile(f)
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() }
                }}
                className={`mt-2 flex h-32 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-md border-2 border-dashed bg-surface-elevated transition ${
                  fileError
                    ? 'border-destructive'
                    : isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary'
                }`}
              >
                {preview ? (
                  <img src={preview} className="h-full w-full object-cover pointer-events-none" alt="preview" />
                ) : (
                  <>
                    <span className={`text-sm font-semibold pointer-events-none ${isDragging ? 'text-primary' : 'text-foreground'}`}>
                      {isDragging ? 'Drop image to upload' : 'Drag & drop image'}
                    </span>
                    <span className="text-mono-xs text-muted-foreground pointer-events-none">or click to browse</span>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
              {(file || fileError) && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  {fileError
                    ? <p className="text-mono-xs text-destructive">{fileError}</p>
                    : file && <p className="truncate text-mono-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); setFileError(null); if (fileRef.current) fileRef.current.value = '' }}
                    className="shrink-0 cursor-pointer text-mono-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="text-mono-xs text-muted-foreground">Name</label>
              <p className="mb-1.5 text-mono-xs text-muted-foreground/60">3-32 lowercase letters or digits — e.g. "tokyo"</p>
              <div className="relative">
                <input
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="tokyo"
                  maxLength={32}
                  className={`w-full rounded-md border bg-input px-3 py-2 text-sm outline-none focus:border-primary ${nameError ? 'border-destructive' : 'border-border'}`}
                />
                {nameChecking && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mono-xs text-muted-foreground">checking…</span>
                )}
              </div>
              {name && !nameFormatValid && <p className="mt-1 text-mono-xs text-destructive">3-32 lowercase letters or digits only</p>}
              {nameError && <p className="mt-1 text-mono-xs text-destructive">{nameError}</p>}
              {nameFormatValid && !nameError && !nameChecking && <p className="mt-1 text-mono-xs text-success">✓ Available</p>}
            </div>

            {/* Initial buy */}
            <div>
              <label className="text-mono-xs text-muted-foreground">
                Initial buy — <span className="text-foreground font-semibold">{initialBuy} key{initialBuy === 1 ? "" : "s"}</span>
              </label>
              <p className="mb-1.5 text-mono-xs text-muted-foreground/60">
                Minimum {CREATOR_MIN_FIRST_BUY} keys required · more keys = higher starting MC
              </p>
              <input type="range" min={CREATOR_MIN_FIRST_BUY} max={CREATOR_MAX_FIRST_BUY} value={initialBuy}
                onChange={(e) => setInitialBuy(Number(e.target.value))}
                className="mt-2 w-full accent-primary" />
              <div className="mt-1 flex justify-between text-mono-xs text-muted-foreground/60">
                <span>{CREATOR_MIN_FIRST_BUY}</span><span>{CREATOR_MAX_FIRST_BUY}</span>
              </div>
            </div>

            {/* Socials — labels stack above inputs on mobile so the input gets the
                full row width (was `w-24` label + flex-1 input which on phones
                left ~150px for the placeholder text). */}
            <div className="space-y-3">
              <p className="text-mono-xs text-muted-foreground">Socials <span className="text-muted-foreground/50">(optional)</span></p>
              {[
                { label: "X (Twitter)", val: xUrl, set: setXUrl, placeholder: "https://x.com/yourhandle" },
                { label: "Telegram",   val: telegramUrl, set: setTelegramUrl, placeholder: "https://t.me/yourchannel" },
                { label: "Website",    val: websiteUrl, set: setWebsiteUrl, placeholder: "https://yoursite.com" },
                { label: "Community",  val: commUrl, set: setCommUrl, placeholder: "https://yourcomm.com" },
              ].map(({ label, val, set, placeholder }) => (
                <div key={label} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-mono-xs text-muted-foreground sm:w-24">{label}</span>
                  <input value={val} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                    className="w-full flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-mono-xs outline-none focus:border-primary" />
                </div>
              ))}
            </div>

            {/* Estimated cost */}
            {nameFormatValid && (
              <div className="rounded-md border border-border bg-background p-3 text-mono-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Launch cost ({initialBuy} key{initialBuy === 1 ? "" : "s"})</span>
                  <span className="tabular-nums font-semibold">{fmtSol(estimatedCost)} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Starting marketcap</span>
                  <span className="tabular-nums text-primary font-semibold">{fmtUsd(startingMc, 150)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max supply</span>
                  <span>10,000 keys</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network</span>
                  <span>Devnet</span>
                </div>
              </div>
            )}
          </div>

          {error && <p className="mt-4 text-mono-xs text-destructive">{error}</p>}

          <div className="mt-6 flex gap-2">
            <Link to="/"
              className="flex flex-1 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-mono-xs hover:bg-muted">
              Cancel
            </Link>
            <button onClick={submit} disabled={!canSubmit}
              className="flex-1 cursor-pointer rounded-md bg-primary px-4 py-2 text-mono-xs font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? 'Launching…' : nameChecking ? 'Checking name…' : preparingTx ? 'Preparing…' : 'Launch Key'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
