# Images for the Friends of Animals app. Production runs on Vercel; these are
# for the local Compose stack and any self-hosted fallback.
#
#   docker compose up -d --build --wait      # db + migrate + app, see docker-compose.yml
#   docker build --build-arg APP_URL=https://friendsofanimals.dev -t foa-app .   # runner (default target)
#   docker build --target migrate -t foa-migrate .
#   docker compose -f docker/workers.yml up -d --build   # worker, see docker/README.md
#
# Targets:
#   runner   Next.js standalone server on :3000, as a non-root user.
#   migrate  Applies pending Drizzle migrations (`pnpm db:migrate`), then exits.
#   worker   The VPS background worker (src/worker/main.ts), as a non-root user.
#   worker-media  The media queue's worker (sharp, ffmpeg and Poppler), as a non-root user.

ARG NODE_IMAGE=node:26-trixie-slim

# ---- base: Node + pnpm --------------------------------------------------------
FROM ${NODE_IMAGE} AS base
# Node 26 ships without corepack, so install pnpm from npm.
RUN npm install --global pnpm@12.21.0 && npm cache clean --force
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- deps: every dependency (the build and the migrate target need dev deps) --
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: compile the Next.js app ------------------------------------------
FROM base AS build
# Prerendered pages bake in the canonical base URL (Open Graph URLs), so
# APP_URL is a build argument as well as a runtime variable. Empty falls back
# to http://localhost:3000.
ARG APP_URL=""
ENV APP_URL=${APP_URL}
# next.config.ts bakes the security headers (HSTS, X-Robots-Tag) from APP_ENV
# at build time, so an unset APP_ENV would ship non-production headers.
# Production needs APP_URL too; Compose passes local for both.
ARG APP_ENV=production
ENV APP_ENV=${APP_ENV}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# check:build fails the image on syntax iOS 16.0 can't parse (#51).
RUN pnpm build && pnpm check:build

# ---- migrate: one-shot migration runner ---------------------------------------
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts
# The migration script parses its env with the shared schema, which names
# preview databases with database-url.ts.
COPY src/env.schema.ts ./src/env.schema.ts
COPY src/server/db/database-url.ts ./src/server/db/database-url.ts
USER node
CMD ["pnpm", "db:migrate"]

# ---- worker: the VPS background worker (#61) ----------------------------------
# Runs src/worker/main.ts through tsx, like the migrate target's script: the
# worker imports only plain-Node modules (the outbox, ports, schema), never
# Next.js. docker/workers.yml runs it as worker-prod, worker-staging and
# worker-preview.
FROM base AS worker
ENV NODE_ENV=production
# The commit, recorded in each database's worker_heartbeat row.
ARG WORKER_VERSION=unknown
ENV WORKER_VERSION=${WORKER_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
# database-url.ts reads the migrations journal; the welcome email its words.
COPY drizzle ./drizzle
COPY messages ./messages
# The scripts docker/README.md runs in the worker (docker/workers.test.ts).
COPY scripts/load-env.ts scripts/purge-preview-files.ts scripts/purge-preview-files-cli.ts ./scripts/
COPY scripts/offsite-restore.ts scripts/offsite-restore-args.ts ./scripts/
COPY src ./src
USER node
CMD ["node", "--import", "tsx", "src/worker/main.ts"]

# ---- worker-media: isolated image, video and essay PDF processing -----------
# Only this image has ffmpeg and ffprobe, for video entries (#86): Debian's
# build, with libx264 (GPL) for the H.264 copies. Self-hosted use
# distributes nothing, so the GPL asks nothing of us here (HR-36 notes it).
# Poppler rasterises essay PDFs into safe blind-judging copies (#96).
FROM worker AS worker-media
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg poppler-utils fonts-liberation fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
# `pnpm test:media` runs the video and PDF contracts against these tools:
#   docker run --rm <a worker-media image> pnpm test:media
COPY vitest.config.ts vitest.media.config.ts ./
COPY fixtures/media ./fixtures/media
COPY public/brand/foa-logo.svg ./public/brand/foa-logo.svg
COPY public/brand/foa-logo-watermark*.png ./public/brand/
COPY public/brand/apple-touch-icon.png ./public/brand/apple-touch-icon.png
USER node
CMD ["node", "--import", "tsx", "src/worker-media/main.ts"]

# ---- runner: the standalone server --------------------------------------------
FROM ${NODE_IMAGE} AS runner
# The same APP_ENV at runtime as the headers were built with.
ARG APP_ENV=production
ENV APP_ENV=${APP_ENV} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Owned by the non-root user so Next.js can write its cache under .next/.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
