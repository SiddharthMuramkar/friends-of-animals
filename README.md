# Friends of Animals

The website for **Friends of Animals**, an animal rescue organisation. It lists animals available for adoption and has an admin area where staff add animals and upload their photos.

The codebase is deliberately lean: one example feature (animals), wired end-to-end through the database, file storage, pages and tests. New features follow the same pattern.

---

## Contents

- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Running everything in Docker](#running-everything-in-docker)
- [Project structure](#project-structure)
- [How a feature is put together](#how-a-feature-is-put-together)
- [Database and migrations](#database-and-migrations)
- [File uploads](#file-uploads)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Deploying to Vercel](#deploying-to-vercel)
- [Scripts reference](#scripts-reference)
- [Before going live](#before-going-live)

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | [React Router 8](https://reactrouter.com) in framework mode (server-side rendering) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 4 + [shadcn/ui](https://ui.shadcn.com) components |
| Database | PostgreSQL 17 |
| ORM and migrations | [Drizzle ORM](https://orm.drizzle.team) + Drizzle Kit, with the `postgres.js` driver |
| File storage | Local disk in development, [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) in production |
| Validation | Zod |
| Tests | Vitest + [PGlite](https://pglite.dev) (in-memory Postgres) |
| Local infrastructure | Docker + Docker Compose |
| Hosting | Vercel, with Neon Postgres |

## Prerequisites

- **Node.js 22.22 or newer.** React Router 8 requires it.
- **Docker** with the Compose plugin (`docker compose version` should work).

## Getting started

```bash
git clone https://github.com/<your-account>/friends-of-animals.git
cd friends-of-animals
npm install
cp .env.example .env          # defaults already match the local database

docker compose up -d db       # start Postgres in Docker
npm run db:migrate            # create the tables
npm run db:seed               # optional: sample animals + an admin user
npm run dev                   # http://localhost:5173
```

Pages to try:

| URL | What it is |
|-----|------------|
| `/` | Home page with featured available animals |
| `/animals` | Adoptable animals, filterable by status |
| `/animals/:id` | An animal's detail page |
| `/admin/animals` | Admin list (**currently unprotected**, see [Before going live](#before-going-live)) |
| `/admin/animals/new` | Add an animal with a photo |

To stop the database, run `docker compose stop db`. The data is kept in a Docker volume until you run `docker compose down -v`.

## Running everything in Docker

You can also build and run the production image together with Postgres:

```bash
docker compose up --build     # http://localhost:3000
```

The app container runs the migrations every time it starts, then serves the built app. Data persists in two named volumes:

| Volume | Holds |
|--------|-------|
| `pgdata` | the Postgres database |
| `uploads` | uploaded photos (mounted at `/data/uploads`) |

To seed the containerised database, run `docker compose exec app npm run db:seed`.

## Project structure

```
app/
├── root.tsx                  # HTML shell, theme script, global meta
├── routes.ts                 # route table: register every new page here
├── routes/
│   ├── layout.app.tsx        # site header / nav / footer
│   ├── home.tsx
│   ├── animals._index.tsx    # /animals
│   ├── animals.$id.tsx       # /animals/:id
│   ├── admin.animals._index.tsx
│   ├── admin.animals.new.tsx # create form + photo upload
│   └── files.$.ts            # serves locally stored uploads at /files/*
├── services/
│   └── animalService.ts      # all animal queries live here (+ .test.ts)
├── db/
│   ├── schema.ts             # Drizzle tables: users, animals
│   ├── enums.ts              # enums that are safe to import in the browser
│   └── index.ts              # lazily created database client (`db`)
├── lib/
│   ├── site.ts               # organisation name, tagline, contact email
│   ├── env.server.ts         # validated environment variables (`env()`)
│   ├── storage/              # file storage: local disk or Vercel Blob
│   ├── session.ts            # cookie session helpers
│   └── validation.ts         # Zod helpers for form data and URL params
├── components/
│   ├── ui/                   # shadcn/ui primitives
│   └── animal-card.tsx, admin-banner.tsx
└── test/setup.ts             # in-memory test database helpers
drizzle/                      # generated SQL migrations (committed)
scripts/
├── migrate.ts                # applies migrations
└── seed.ts                   # sample data for development
docs/deploy-vercel-notes.md   # details on the Vercel setup
Dockerfile
docker-compose.yml
```

Files ending in `.server.ts` only run on the server and never ship to the browser.

## How a feature is put together

The animals feature is the reference for new features (adoption applications, events, volunteers…):

1. **Schema.** Add a table in `app/db/schema.ts`, then generate a migration (see below).
2. **Service.** Put the queries in `app/services/<thing>Service.ts`. Routes never query the database directly.
3. **Test.** Write `app/services/<thing>Service.test.ts` against the in-memory database.
4. **Routes.** Load data in a `loader`, handle forms in an `action`, and validate input with the helpers in `app/lib/validation.ts`.
5. **Register.** Add the route in `app/routes.ts`. `npm run typecheck` then generates the route types.

## Database and migrations

The schema in `app/db/schema.ts` is the source of truth. To change the database:

```bash
# 1. edit app/db/schema.ts
npm run db:generate    # 2. writes a new SQL file to drizzle/
                       # 3. review the SQL and commit it with your change
npm run db:migrate     # 4. apply it to your database
```

Migrations are applied automatically in two places: when the Docker container starts, and during the Vercel build. Never edit a migration that has already been applied anywhere; generate a new one instead.

`npm run db:studio` opens Drizzle Studio, a browser UI for the database.

## File uploads

Code never writes to the filesystem directly. It goes through the storage interface, which picks the backend from `STORAGE_DRIVER`:

```ts
import { getStorage, makeUploadKey } from "~/lib/storage/index.server";

const storage = getStorage();
const { key } = await storage.put(makeUploadKey("animals", file.name), file, {
  contentType: file.type,
});
// save `key` in the database; build the image URL later with storage.url(key)
```

| `STORAGE_DRIVER` | Where files go | Used for |
|------------------|----------------|----------|
| `local` (default) | `UPLOAD_DIR` on disk, served from `/files/*` | development, Docker |
| `blob` | Vercel Blob (needs `BLOB_READ_WRITE_TOKEN`) | production on Vercel |

Uploads accept JPEG, PNG, WebP, GIF and AVIF images up to 5 MB.

## Testing

```bash
npm test             # run once
npm run test:watch   # watch mode
npm run typecheck    # generate route types + run tsc
```

Tests don't need Docker. Each test gets a fresh in-memory Postgres (PGlite), which runs the real migrations, and the app's `db` is swapped for it:

```ts
import { createTestDb, type TestDb } from "~/test/setup";

let testDb: TestDb;
vi.mock("~/db", () => ({ get db() { return testDb; } }));

beforeEach(async () => {
  testDb = await createTestDb();
});
```

See `app/services/animalService.test.ts` for a complete example.

## Environment variables

Copy `.env.example` to `.env` for local development. The defaults match the Docker Compose database.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | always | Postgres connection string. Neon's *pooled* URL works (the client disables prepared statements). |
| `SESSION_SECRET` | in production | At least 32 characters; generate one with `openssl rand -base64 32`. A dev fallback is used locally. |
| `STORAGE_DRIVER` | no | `local` (default) or `blob`. |
| `UPLOAD_DIR` | no | Upload directory for the local driver. Default `./data/uploads`; `/data/uploads` in Docker. |
| `BLOB_READ_WRITE_TOKEN` | when `STORAGE_DRIVER=blob` | Set automatically when a Blob store is connected on Vercel. |

> `npm start` runs in production mode, so it needs a `SESSION_SECRET` of 32+ characters even on your machine.

## Deploying to Vercel

1. Import the GitHub repo into Vercel. React Router is detected automatically and no `vercel.json` is needed.
2. In the project's **Storage** tab, add:
   - a **Neon** Postgres database, which sets `DATABASE_URL`;
   - a **Blob** store, which sets `BLOB_READ_WRITE_TOKEN`.
3. Under **Settings → Environment Variables**, add `SESSION_SECRET` (a random value) and `STORAGE_DRIVER=blob`.
4. Deploy.

Vercel runs the `vercel-build` script, which applies the migrations before building. That means:

- `DATABASE_URL` must be available at **build** time.
- Preview deployments migrate whatever database they point at. Give previews their own Neon branch so they never touch production data.

> The official `@vercel/react-router` preset doesn't support React Router 8 yet. Vercel's zero-config deployment works without it. See [`docs/deploy-vercel-notes.md`](docs/deploy-vercel-notes.md) for the details and how to enable the preset once it's released.

## Scripts reference

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `build/` |
| `npm start` | Serve the production build (port 3000) |
| `npm run typecheck` | Generate route types and type-check |
| `npm test` / `npm run test:watch` | Run tests |
| `npm run db:generate` | Create a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Reset sample data (**wipes** animals and users) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run brand:assets` | Regenerate the logo PNGs and icons in `public/brand/` from the SVG master (see `public/brand/README.md`) |
| `npm run vercel-build` | Migrate + build (used by Vercel) |

## Before going live

- [ ] **Add authentication to `/admin`.** It is currently open to anyone; search for `TODO(auth)`.
- [ ] Update the organisation details in `app/lib/site.ts`. (The logo, favicon and social preview are done: see `public/brand/`.)
- [ ] Set a strong `SESSION_SECRET` in Vercel.
- [ ] Give preview deployments their own Neon branch.
