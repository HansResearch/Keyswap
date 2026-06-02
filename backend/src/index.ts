import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './env.js'
import { keysRouter } from './routes/keys.js'
import { uploadRouter } from './routes/upload.js'
import { startIndexer } from './lib/indexer.js'
import { startSolPricePoller, getSolPrice } from './lib/sol-price.js'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'

await mkdir(env.PFP_DIR, { recursive: true })

const app = new Hono()

app.use('*', cors({ origin: '*' }))

// Serve uploaded PFPs from env.PFP_DIR. Custom handler (instead of serveStatic)
// because @hono/node-server's serveStatic only accepts CWD-relative paths,
// but our PFP_DIR may be absolute (e.g. /data/pfp on a Railway volume).
const PFP_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}
app.get('/pfp/:filename', async (c) => {
  const filename = c.req.param('filename')
  if (!/^[a-z0-9._-]+$/i.test(filename) || filename.includes('..')) return c.notFound()
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = PFP_MIME[ext]
  if (!mime) return c.notFound()
  try {
    const data = await readFile(join(env.PFP_DIR, filename))
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return c.notFound()
  }
})

app.route('/api/keys', keysRouter)
app.route('/api/upload-pfp', uploadRouter)

app.get('/health', (c) => c.json({ ok: true }))
app.get('/api/sol-price', (c) => c.json({ usd: getSolPrice() }))

// ─── Frontend SPA ─────────────────────────────────────────────────────────────
// In production, the Vite dist/ folder is copied to ./web during the Docker
// build. Serve those static assets, then fall back to index.html for any
// unknown route so client-side routing works (/launch, /k/<id>, /portfolio).
const FRONTEND_DIR = process.env.FRONTEND_DIR ?? './web'

import { stat as fsStat } from 'fs/promises'
import { createReadStream } from 'fs'

const FRONTEND_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js:   'application/javascript; charset=utf-8',
  mjs:  'application/javascript; charset=utf-8',
  css:  'text/css; charset=utf-8',
  json: 'application/json',
  svg:  'image/svg+xml',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif:  'image/gif',
  ico:  'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf:  'font/ttf',
  map:  'application/json',
}

async function tryServeFile(filepath: string): Promise<Response | null> {
  try {
    const s = await fsStat(filepath)
    if (!s.isFile()) return null
    const ext = filepath.split('.').pop()?.toLowerCase() ?? ''
    const mime = FRONTEND_MIME[ext] ?? 'application/octet-stream'
    // Long cache for hashed assets, no-cache for index.html
    const cache = filepath.endsWith('/index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable'
    const stream = createReadStream(filepath) as unknown as ReadableStream<Uint8Array>
    return new Response(stream as any, {
      headers: { 'Content-Type': mime, 'Content-Length': String(s.size), 'Cache-Control': cache },
    })
  } catch {
    return null
  }
}

app.get('*', async (c) => {
  const reqPath = c.req.path
  // Try as a direct file first (e.g. /assets/index-abc123.js, /favicon-32.png)
  const safePath = reqPath.replace(/\.\./g, '').replace(/^\/+/, '')
  if (safePath) {
    const direct = await tryServeFile(join(FRONTEND_DIR, safePath))
    if (direct) return direct
  }
  // SPA fallback — serve index.html for any unknown path so TanStack Router
  // can hydrate client-side routes (/launch, /k/<id>, /portfolio, etc.)
  const index = await tryServeFile(join(FRONTEND_DIR, 'index.html'))
  if (index) return index
  return c.text('Frontend not bundled into this image', 503)
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`keyswap api + web  →  http://localhost:${info.port}`)
})

startIndexer()
startSolPricePoller()
