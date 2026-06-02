import { writeFile, mkdir } from 'fs/promises'
import { join, extname } from 'path'
import { env } from '../env.js'

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
])

export const MAX_BYTES = 2 * 1024 * 1024

export async function savePfp(name: string, buf: Buffer, contentType: string): Promise<string> {
  const ext = ALLOWED.get(contentType)
  if (!ext) throw new Error('Only JPEG/PNG/WebP/GIF allowed')

  await mkdir(env.PFP_DIR, { recursive: true })
  const filename = `${name}${ext}`
  await writeFile(join(env.PFP_DIR, filename), buf)
  return `${env.PFP_BASE_URL}/${filename}`
}
