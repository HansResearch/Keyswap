# Two-stage build: builder compiles TS → tiny runtime image runs the compiled JS.
# Using debian-slim because better-sqlite3 ships prebuilt binaries for glibc
# (Alpine uses musl and would force compilation from source).

# ─── Stage 1: build ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install only what's needed to compile any native module that lacks a prebuild
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Stage 2: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Only production deps in the final image
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Frontend SPA — copied here by a local `npm run build` in lovable-frontend/ and
# `cp -r dist ../backend/web` before deploy. Backend serves these at / with a
# SPA fallback to index.html for any unknown route.
COPY web ./web

# Mount targets — Railway overlays its persistent volume on /data at runtime.
# The volume mounts as root-owned (Railway limitation), and chown at build time
# doesn't survive the runtime mount, so we run as root for write access.
# (If you later move to S3/R2 for storage, switch back to USER node.)
RUN mkdir -p /data/pfp

EXPOSE 3001

# Honor PORT env var if Railway sets one (it does — for routing)
CMD ["node", "dist/index.js"]
