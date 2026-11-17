# Production image for the Friends of Animals site (any Docker engine).
# React Router 8 requires Node >= 22.22.0; node:22-slim tracks the latest 22.x.
#
#   docker build -t rescue-site .
#   docker compose up --build        # app + Postgres, see docker-compose.yml
#
# On start the container runs pending Drizzle migrations, then serves on :3000.

ARG NODE_IMAGE=node:22-slim

# ---- deps: install every dependency (dev deps included: the build needs vite,
# and the runtime migration step needs tsx + drizzle) --------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm 10 (bundled with Node 22) ignores package.json "allowScripts" and runs
# install scripts as usual, so esbuild's postinstall runs here.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build: compile the React Router app -------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# mkdir: the runtime stage copies these folders, so make sure they exist even
# before the first migration has been generated.
RUN npm run build && mkdir -p drizzle scripts

# ---- runtime ------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DRIVER=local \
    UPLOAD_DIR=/data/uploads

# Full node_modules from the deps stage: `npm run db:migrate` runs through tsx
# at container start, which is a dev dependency.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts ./scripts
# The migrate/seed scripts import the schema and db client from app/db.
COPY --from=build --chown=node:node /app/app/db ./app/db

# Upload directory, owned by the non-root user so a fresh named volume mounted
# here inherits writable permissions.
RUN mkdir -p /data/uploads && chown -R node:node /data
VOLUME ["/data/uploads"]

USER node
EXPOSE 3000

CMD ["sh", "-c", "npm run db:migrate && exec npm start"]
