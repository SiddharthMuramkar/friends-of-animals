# Friends of Animals

The web platform for **Friends of Animals (FOA)**, a non-profit in India that nurtures compassion for animals among children and young adults through creative competitions, community, awareness, adoption facilitation and fundraising.

What it will do is specified in [`specifications/SPEC.md`](specifications/SPEC.md). The build follows the milestones in SPEC §14. Right now the app is the bare foundation: a brand landing page, the site shell, the database layer and the test harness. The public site arrives in [#14](https://github.com/SiddharthMuramkar/friends-of-animals/issues/14).

---

## Contents

- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Running everything in Docker](#running-everything-in-docker)
- [Scripts](#scripts)
- [Project layout](#project-layout)
- [Database and migrations](#database-and-migrations)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Deploying](#deploying)
- [Brand assets](#brand-assets)

---

## Tech stack

The stack and hosting layout were locked in [#11](https://github.com/SiddharthMuramkar/friends-of-animals/issues/11); SPEC §2 is the reference. In this repo today:

| Layer              | Choice                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Framework          | [Next.js 16](https://nextjs.org) App Router with Cache Components, Turbopack, `output: "standalone"`                 |
| Language           | TypeScript 7 (strict) on Node.js 26                                                                                  |
| UI                 | Tailwind CSS 4, [shadcn/ui](https://ui.shadcn.com), `next/font` (Inter), lucide icons, sonner toasts                 |
| Validation         | Zod 4                                                                                                                |
| Database           | PostgreSQL 18                                                                                                        |
| ORM and migrations | [Drizzle ORM](https://orm.drizzle.team) 0.45 + drizzle-kit, on the `postgres.js` driver                              |
| Tests              | [Vitest](https://vitest.dev) + [PGlite](https://pglite.dev) (in-memory Postgres)                                     |
| Lint and format    | [oxlint](https://oxc.rs/docs/guide/usage/linter) (type-aware) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) |
| Package manager    | pnpm 12                                                                                                              |
| Hosting            | Vercel (functions in `bom1`, Mumbai); Postgres on the Mumbai VPS                                                     |

Every dependency in `package.json` is pinned to an exact version, and `saveExact: true` in `pnpm-workspace.yaml` makes `pnpm add` do the same.

Still to come, each in its own M0 ticket: Better Auth, Cloudflare R2 storage, the pg-boss worker, next-intl, React Email, Sentry, and CI with Playwright.

## Prerequisites

- **Node.js 26.** `package.json` pins `engines.node` to `26.x`, which is also Vercel's default.
- **pnpm 12.** Node 26 ships without corepack, so install it from npm: `npm install --global pnpm@12.21.0`.
- **Docker** with the Compose plugin (`docker compose version` should work).

## Getting started

```bash
git clone https://github.com/SiddharthMuramkar/friends-of-animals.git
cd friends-of-animals
pnpm install
cp .env.example .env          # defaults match the local database

docker compose up -d db       # start Postgres 18 in Docker
pnpm db:migrate               # apply the migrations
pnpm dev                      # http://localhost:3000
```

To stop the database, run `docker compose stop db`. The data stays in the `pgdata18` volume.

> **Upgrading an older checkout?** The Compose database moved to Postgres 18 with a new user, on a new volume, `pgdata18`, so it starts empty and never mounts the old Postgres 17 data. The React Router template's `pgdata` volume is left alone: if you no longer need it, find it with `docker volume ls` (it is named `<project>_pgdata`) and remove it with `docker volume rm`.

## Running everything in Docker

You can also build and run the production image together with Postgres:

```bash
docker compose up -d --build --wait   # http://localhost:3000
docker compose down                   # stop; the database stays in pgdata18
```

Compose starts three services in order:

| Service   | What it does                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `db`      | Postgres 18. Data in the `pgdata18` volume.                                                                                |
| `migrate` | One-shot: runs `pnpm db:migrate` (the Dockerfile's `migrate` target), then exits.                                          |
| `app`     | The Next.js standalone server (the Dockerfile's `runner` target), as a non-root user. Starts once `migrate` has succeeded. |

Ports are published on `127.0.0.1` only, because Docker's published ports bypass host firewalls such as ufw. Reach them from another machine through an SSH tunnel.

## Scripts

| Script                              | What it does                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Dev server with hot reload (Turbopack)                                                                                              |
| `pnpm build`                        | Production build into `.next/` (includes `.next/standalone`)                                                                        |
| `pnpm start`                        | Serve the production build on port 3000 (`next start` warns under `output: "standalone"`; Docker runs `.next/standalone/server.js`) |
| `pnpm typecheck`                    | Generate Next.js route types, then run `tsc`                                                                                        |
| `pnpm lint`                         | oxlint with type-aware rules                                                                                                        |
| `pnpm format` / `pnpm format:check` | Format with oxfmt / check formatting                                                                                                |
| `pnpm test` / `pnpm test:watch`     | Run the tests once / in watch mode                                                                                                  |
| `pnpm check`                        | typecheck + lint + format:check + test: run it before you push                                                                      |
| `pnpm db:generate`                  | Create a migration from schema changes (needs `DIRECT_URL` set, even though it does not connect)                                    |
| `pnpm db:migrate`                   | Apply pending migrations                                                                                                            |
| `pnpm db:studio`                    | Open Drizzle Studio                                                                                                                 |
| `pnpm brand:assets`                 | Regenerate the logo PNGs and icons in `public/brand/` from the SVG master                                                           |
| `pnpm vercel-build`                 | Migrate, then build (Vercel runs this)                                                                                              |

## Project layout

The layout follows SPEC §2.1. The parts that exist today:

```
src/
├── app/                      # App Router
│   ├── layout.tsx            # <html>, metadata, Inter, theme script, header/footer, toaster
│   ├── page.tsx              # brand landing page
│   ├── not-found.tsx, error.tsx, global-error.tsx
│   └── globals.css           # Tailwind 4 + shadcn theme
├── components/
│   ├── ui/                   # shadcn/ui primitives
│   └── logo.tsx, site-header.tsx, site-footer.tsx, theme-toggle.tsx
├── lib/                      # pure utilities, safe anywhere: site.ts (branding), utils.ts (cn), theme.ts
├── env.schema.ts             # Zod env schemas + `parseEnv()`; no server-only, so scripts can use it
├── env.ts                    # server-only, cached config accessor (`env()`)
├── instrumentation.ts        # validates the env when the server starts (+ instrumentation-node.ts)
├── server/db/
│   ├── index.ts              # lazily connected Drizzle client (`db`)
│   └── schema/index.ts       # schema barrel: one file per module, re-exported here
└── test/db.ts                # PGlite test database (`createTestDb()`)
drizzle/                      # generated SQL migrations (committed)
scripts/
├── migrate.ts                # applies migrations through DIRECT_URL
├── load-env.ts               # loads .env.local and .env for scripts and drizzle-kit
└── brand-assets.ts           # derives logo PNGs and icons from the SVG master
public/brand/                 # the registered logo: SVG master + derived assets
specifications/               # the platform spec
Dockerfile, docker-compose.yml
```

Still to come, per SPEC §2.1: the route groups under `src/app/`, `src/server/{domain,jobs,integrations,auth}/`, `src/worker/`, `src/emails/`, `src/i18n/` + `messages/`, `docker/` for the VPS, and `tests/e2e/`.

Code that must never reach the browser starts with `import "server-only"`, so importing it from a Client Component fails the build. Today that is `src/env.ts` and `src/server/db/index.ts`.

Outside a Next.js server bundle, `server-only` throws as soon as it is imported. So the schema files in `src/server/db/schema/` (drizzle-kit loads them), `src/env.schema.ts` (the migration script and drizzle-kit parse their env with it), `scripts/`, and anything else that runs under plain Node must not import it, directly or through another module. The future `src/worker/` must either stick to such modules or start Node with `--conditions=react-server`, under which `server-only` resolves to an empty module.

## Database and migrations

The Drizzle schema in `src/server/db/schema/` is the source of truth. Add one file per module and re-export it from `schema/index.ts`. To change the database:

```bash
# 1. edit src/server/db/schema/
pnpm db:generate       # 2. writes a new SQL file to drizzle/
                       # 3. review the SQL and commit it with your change
pnpm db:migrate        # 4. apply it to your database
```

For SQL that Drizzle can't express (extensions, functions, triggers), create an empty migration with `pnpm db:generate --custom --name <what_it_does>` and write the SQL yourself. The first migration, `0000_enable_pg_trgm`, is one: it enables `pg_trgm` for search (SPEC §2).

Never edit a migration that has already been applied anywhere; generate a new one instead.

The app's `db` client connects on first use, with prepared statements off (PgBouncer in transaction mode doesn't support them). Importing it needs no database, so `next build` runs without `DATABASE_URL`; the server itself won't start without it (see [Environment variables](#environment-variables)).

## Testing

```bash
pnpm test             # run once
pnpm test:watch       # watch mode
```

Tests don't need Docker. `createTestDb()` returns a fresh in-memory Postgres (PGlite) with `pg_trgm` loaded and the real migrations from `drizzle/` applied. Code under test imports `db` from `@/server/db`; swap it for the test database:

```ts
import { beforeEach, vi } from "vitest";
import { createTestDb, type TestDb } from "@/test/db";

let testDb: TestDb;
vi.mock("@/server/db", () => ({
  get db() {
    return testDb;
  },
}));

beforeEach(async () => {
  testDb = await createTestDb();
});
```

Under Vitest, `server-only` resolves to an empty module, so server code can be imported directly. Playwright end-to-end tests will run in GitHub Actions CI, not on the VPS.

## Environment variables

Copy `.env.example` to `.env` for local development. Next.js, drizzle-kit and `pnpm db:migrate` all read it. In app code, read server config through `env()` from `@/env` rather than `process.env`.

The schemas live in `src/env.schema.ts`. The server validates its environment as it starts (`register()` in `src/instrumentation.ts`): if a required variable is missing or invalid, it prints the problems and exits instead of serving errors. `next build` needs no database: code that runs while pages are prerendered reads only `buildEnvSchema` (`APP_URL`, `APP_ENV`, `NODE_ENV`). A local run may leave all of them out. A deployment may not: `APP_URL` is required whenever `APP_ENV` is anything but `local`, and `APP_ENV` is required on Vercel (where `VERCEL` is set), at build time and at runtime.

| Variable       | Required                      | Description                                                                                                                                                                            |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | to start the server           | Runtime Postgres URL. On Vercel: PgBouncer on the VPS. Not needed by `next build`.                                                                                                     |
| `DIRECT_URL`   | for migrations                | Direct (session-mode) URL for `pnpm db:migrate` and drizzle-kit, which never fall back to `DATABASE_URL`. Locally the same URL as `DATABASE_URL`.                                      |
| `APP_URL`      | when `APP_ENV` is not `local` | Canonical base URL for absolute URLs (Open Graph images). Defaults to `http://localhost:3000`. Read only on the server, but prerendered pages bake it in, so set it at build time too. |
| `APP_ENV`      | on Vercel                     | `local` (default), `preview`, `staging` or `production`. Branch on this for behaviour switches, not on `VERCEL_ENV`.                                                                   |

## Deploying

The app runs on Vercel Pro with its functions in `bom1` (Mumbai), set in `vercel.json`. Vercel detects Next.js and runs the `vercel-build` script, which applies the migrations and then builds:

- Migrations connect through `DIRECT_URL` only (a PgBouncer session-mode entry with a migrator role), never `DATABASE_URL`. It must be available at **build** time: without it `pnpm db:migrate` exits with an error and the deployment fails.
- Each preview deployment will get its own database (`foa_pr_<n>`) on the non-production Postgres. Staging, the Vercel custom environment `staging` at foa.shipped-it.dev, will use `foa_staging`.
- The production database (Postgres 18 on the Mumbai VPS behind PgBouncer, with backups) arrives in [#12](https://github.com/SiddharthMuramkar/friends-of-animals/issues/12), and the per-preview databases in #12 and #13. Until then there is no database for Vercel to migrate.

Set `APP_ENV` and `APP_URL` per environment in the Vercel project settings; without them the build fails. Vercel exposes them to the build as well as at runtime, which `APP_URL` needs.

## Brand assets

The FOA logo is a registered mark. `public/brand/` holds the SVG master and every derived PNG and icon; its [README](public/brand/README.md) explains the files and the rules. Never redraw or recolour it. To regenerate the derived files from the master, run `pnpm brand:assets`.
