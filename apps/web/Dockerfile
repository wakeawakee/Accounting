# KarSathi web: build the static site, then serve it from a tiny non-root nginx.
# Build from the repo root (pnpm workspace):
#   docker build -f apps/web/Dockerfile --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... .

# ---- Stage 1: build (Node + pnpm). Thrown away after; never shipped. ----
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Manifests first: the install layer is cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY supabase/test/package.json supabase/test/
RUN pnpm install --frozen-lockfile --filter @karsathi/web...

COPY packages/shared packages/shared
COPY apps/web apps/web

# Public, build-time config (baked into the JS). Never pass real secrets as build args.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_ENV=staging
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
    || { echo "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY build args"; exit 1; }

WORKDIR /repo/apps/web
RUN pnpm exec tsc -p . && pnpm exec vite build

# ---- Stage 2: runtime. Only nginx + static files; runs as uid 101, not root. ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
