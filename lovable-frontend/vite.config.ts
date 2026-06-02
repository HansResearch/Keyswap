// Minimal Vite config — pure SPA build. Replaces the previous @lovable.dev/vite-tanstack-config
// wrapper, which forced a Cloudflare Worker SSR build. Old wrapper config preserved as
// vite.config.lovable.bak.ts in case we revert.
//
// SPA output: dist/index.html + dist/assets/* — servable from any static host (and bundled
// into the backend Docker image for one-domain deployment).

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    // File-based routing — generates src/routeTree.gen.ts from src/routes/*
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-router', '@tanstack/react-query'],
  },

  server: {
    port: 5174,
    strictPort: true,
  },

  // Solana / web3.js workarounds for CJS packages that reference `global`
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      define: { global: 'globalThis' },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500, // Solana + Anchor bundles are heavy
  },
})
