# Deploying to Vercel (React Router 8) — notes

Researched 2026-11-17. Stack: React Router 8.3 (framework mode, SSR), Neon Postgres, Vercel Blob.

## TL;DR

- **No Vercel preset.** `react-router.config.ts` is plain `ssr: true`.
- Vercel detects the project as **React Router** (from `@react-router/dev`) and deploys it with
  zero config: static assets from `build/client`, and **one Node.js Vercel Function** wrapping
  `build/server/index.js`.
- The build runs `npm run vercel-build` (`npm run db:migrate && react-router build`), so
  migrations are applied to `DATABASE_URL` on every deploy.
- `vercel.json` is not needed.

## Why not `@vercel/react-router` / `vercelPreset()`

- Latest `@vercel/react-router` is **1.3.7** (npm, modified 2026-09-29). Its peer deps are still
  `@react-router/dev: "7"` and `@react-router/node: "7"`, so `npm install` fails with ERESOLVE
  against React Router 8 unless `--force` / `--legacy-peer-deps` is used (which this template
  avoids).
- Upstream tracking: issue [vercel/vercel#16730](https://github.com/vercel/vercel/issues/16730)
  ("[react-router] Support React Router v8", open, last activity 2026-10-16) and PR
  [vercel/vercel#16736](https://github.com/vercel/vercel/pull/16736) (widens peers to `7 || 8`,
  drops the removed `AppLoadContext` type import; approved 2026-08-04 but **still open, not
  merged/released**). Some third-party sites wrongly list it as merged; the GitHub API says
  `merged: false`.
- There is no newer/alternative official adapter. Vercel's docs
  ([React Router on Vercel](https://vercel.com/docs/frameworks/frontend/react-router)) say
  React Router deploys "with zero configuration" and the preset is "optional" but "highly
  recommended".

## Why zero-config works without the preset

Checked in the source of the builder Vercel uses, `@vercel/remix-builder@31.0.1` (published
2026-11-17), `dist/index.js`:

- If `.vercel/react-router-build-result.json` (written by the preset) is missing but `build/`
  exists, it logs `WARN: The vercelPreset() Preset was not detected.` and falls back to a single
  server bundle at `build/server/index.js` with `build/client` as static output.
- Its function entry (`defaults/server-react-router.mjs`) calls
  `createRequestHandler(build)` and passes a `RouterContextProvider` only when
  `build.future.v8_middleware` is set. In RR8 that flag no longer exists, so it calls
  `handler(request)`; RR 8.3's `createRequestHandler` then creates
  `new RouterContextProvider()` itself (`lib/server-runtime/server.js`), so middleware and
  context work.

What you lose without the preset (from the Vercel docs): per-route function config
(`maxDuration`, memory, regions) via route `export const config`, per-route bundle splitting,
and an accurate route list in the Deployment Summary. None of that matters for this template.

## When upstream ships RR8 support

Once a `@vercel/react-router` release lists `@react-router/dev` 8 as a peer:

```ts
// react-router.config.ts
import { vercelPreset } from "@vercel/react-router/vite";
export default { ssr: true, presets: [vercelPreset()] } satisfies Config;
```

and `npm i -D @vercel/react-router`. Check with
`npm view @vercel/react-router peerDependencies`.

## Project setup checklist

1. Import the repo in Vercel; framework preset is auto-detected as React Router. Leave the
   build command empty (the `vercel-build` script is used).
2. Node.js version: Vercel's default (24.x) is fine; React Router 8 needs >= 22.22.
3. Storage → add **Neon** (Marketplace) → sets `DATABASE_URL`.
   - Neon's **pooled** URL (host contains `-pooler`, PgBouncer transaction mode) needs
     prepared statements off in postgres.js: `postgres(url, { prepare: false })`.
     Handled in `app/db`.
   - Migrations run during the build, so `DATABASE_URL` must be available to the **build**
     environment. Previews migrate whatever database their `DATABASE_URL` points at — use
     Neon's per-preview branch integration, or scope the variable so previews don't migrate
     production.
4. Storage → add **Blob** → sets `BLOB_READ_WRITE_TOKEN`. Set `STORAGE_DRIVER=blob`.
5. Set `SESSION_SECRET` (`openssl rand -base64 32`). `UPLOAD_DIR` is unused with `blob`
   (Vercel Functions have no persistent disk).
