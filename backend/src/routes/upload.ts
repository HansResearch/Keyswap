import { Hono } from 'hono'
import { savePfp, MAX_BYTES } from '../lib/storage.js'
import { db } from '../lib/db.js'

export const uploadRouter = new Hono()

// POST /api/upload-pfp  (multipart/form-data: file, name)
uploadRouter.post('/', async (c) => {
  const body = await c.req.parseBody()
  const name = (body['name'] as string | undefined)?.toLowerCase()
  const file = body['file'] as File | undefined

  if (!name || !/^[a-z0-9]{3,32}$/.test(name)) return c.json({ error: 'Invalid name' }, 400)
  if (!file || !(file instanceof File))           return c.json({ error: 'No file' }, 400)
  if (file.size > MAX_BYTES)                      return c.json({ error: 'Max 2 MB' }, 400)

  const buf = Buffer.from(await file.arrayBuffer())
  const url = await savePfp(name, buf, file.type)

  db.prepare(`
    UPDATE keys SET pfp_url = ?, updated_at = datetime('now') WHERE name = ?
  `).run(url, name)

  return c.json({ url })
})
