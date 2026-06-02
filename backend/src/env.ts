function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}. See backend/.env.example.`)
  return v
}

export const env = {
  PORT:         Number(process.env.PORT ?? 3001),
  DB_PATH:      process.env.DB_PATH ?? './keytech.db',
  PFP_DIR:      process.env.PFP_DIR ?? './public/pfp',
  PFP_BASE_URL: process.env.PFP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}/pfp`,
  // These two MUST be set — no defaults, so a missing value fails fast at boot
  // instead of silently using a hardcoded (and previously leaked) value.
  SOLANA_RPC:   required('SOLANA_RPC'),
  PROGRAM_ID:   required('PROGRAM_ID'),
}
