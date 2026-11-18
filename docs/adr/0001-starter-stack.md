# ADR-0001: The checked-in app is a React Router, Drizzle, and Postgres starter

- Status: Accepted
- Date: 2026-11-17

## Context

The repository started as a small website that lists animals and lets someone add one, with tests. That code is what `main` runs. The platform spec in `specifications/` describes a different, larger product and names a different stack. Those are not the same decision. The larger choice is ADR-0002, which is pending.

Evidence: `package.json`, `README.md`, `react-router.config.ts`, `app/db/index.ts`, `app/lib/storage/`, `vitest.config.ts`.

## Decision

The application in this repo today is:

- React Router 8 in framework mode, with server rendering (`ssr: true`). No Vercel React Router preset, because that package did not support version 8 when the note in `docs/deploy-vercel-notes.md` was written.
- TypeScript, Tailwind CSS 4, and shadcn/ui.
- PostgreSQL, accessed with Drizzle ORM and the `postgres.js` driver. Prepared statements are off (`prepare: false`) so a pooled Neon-style URL can work.
- Zod for input checks.
- Vitest with PGlite (an in-memory Postgres) for tests, so the test suite does not need a database server.
- Uploads through the storage interface in `app/lib/storage`. `local` stores files on disk. `blob` uses Vercel Blob. Routes do not write to the disk themselves.

New features in this starter follow that shape: a table, a service, a service test, a route, then a line in `app/routes.ts`.

## Consequences

- Agents building a ticket against the current code use this stack.
- Replacing it is a platform decision and is not implied by this ADR. See ADR-0002.
- Which file store production will use is part of that pending decision. Until then, the two drivers above are the ones the code has.
