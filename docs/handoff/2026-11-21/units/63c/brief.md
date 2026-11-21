# Brief 63c: purge on preview drop, demo page, files journey

Unit 63c of #63 (M0). Branch `ticket/63-prefixes-seam2`, worktree `/root/foa-wt/63c`. M, risk (A K J). No X key.
Blocked by 63b. PR base `M0`, title `M0 #63: Private file uploads with malware scan and signed delivery (prefixes+Seam2)`.

## Scope
**In (63c):**
- **Purge on drop.** When the sweeper drops a preview database, delete that preview's storage prefix. It uses 63a's `storagePrefixForDatabase` (`foa_pr_12` → `pr-12/`, `foa_br_<slug>_<hash8>` → `br-<hash8>/`) and `ObjectStorage.deletePrefix`.
  - A CLI `pnpm files:purge-preview --database <name>` (`scripts/purge-preview-files.ts`), run by a hook `docker/scripts/preview-dropped.d/50-purge-files.sh`. 61b creates the hook directory and its call in the sweeper.
- **Demo page.** `/account/files` (signed-in, outside production only): pick a file, presign, upload with `fetch(PUT)` from a small client island, complete, poll status, and a "Download" link to `/api/files/<id>`.
- **Copy.** New namespace `files` (labels, limits, statuses, errors).
- **Seam 2.** `tests/e2e/63-files.spec.ts` with `expectRendersAccessibly` (light and dark).
- **Seed.** A preview seeder with one clean demo file row per seeded member. Metadata only: no object is written, the status is `clean`, and the key sits under the preview prefix.

**Out:** prefix derivation and the key layout (63a, already built on `ticket/63-storage` as `domain/storage-key.ts`), scanning (63b), the image UI for entries (#85).

## Acceptance criteria (numbered, with seam)
1. **Purge only that prefix** (seam1). Put objects under `pr-12/`, `pr-120/`, `staging/` and `br-abcd1234/` in the storage fake. `purgePreviewFiles({database:"foa_pr_12"})` deletes only `pr-12/*`. `foa_pr_120` is untouched (trailing-slash rule).
2. **Refuses unsafe targets** (seam1). The database names `foa`, `foa_seed` and `postgres`, an empty name, and any name with no preview mapping all throw. Nothing is deleted, and the CLI exits non-zero. Production `APP_ENV` refuses outright.
3. **Hook wiring** (evidence). `bash -n` passes on the hook. It reads the dropped database name from `$1`. It runs the CLI from the worker image with non-production R2 credentials, never production ones. 61b's sweeper calls `preview-dropped.d/*` after each `DROP DATABASE`.
4. **Demo page** (seam2). A signed-in seeded member opens `/account/files`, uploads a small PNG, sees "Checking for viruses", then "Ready", and the Download link returns 200 with `image/png` from the signed URL. A visitor is redirected to sign-in. In production the page is a 404.
5. **Journey on the preview** (seam2). `tests/e2e/63-files.spec.ts` passes the round trip and an over-limit file refused by the server, with the message shown. Run locally on port 3100 when a local stack exists. On the preview it stays `deferred` until HR-01, HR-02, HR-06 and HR-08 are done.
6. **axe** (seam2). `expectRendersAccessibly(page, "/account/files")` in light and dark, at 320–412 px with no horizontal scroll.
7. **Copy** (unit). The `files` namespace passes the messages tests (banned phrases, ICU), and the page has no literals.

## Files
- New: `scripts/purge-preview-files.ts` (+test), `src/server/modules/files/purge.ts` (+test), `docker/scripts/preview-dropped.d/50-purge-files.sh`, `package.json` script line.
- New: `src/app/account/files/{page.tsx,_components/upload-form.tsx,_lib/upload.ts(+test)}`, `messages/en-IN/files.json`, `tests/e2e/63-files.spec.ts`.
- New: `src/server/seed/files.ts`, plus one line in the `seeders` list.
- Touch, append-only: `src/i18n/messages.ts` (3 lines), 57b's `app-routes.ts` / `SIGNED_IN_PREFIXES` if `/account` isn't covered yet, `src/server/seed/index.ts`.
- `/account/*` is shared with 57b, 57c and 64: create only `account/files/**`. If the account layout doesn't exist, keep auth in the page (`actorFromRequest` under `<Suspense>`, `await connection()`).

## Design
- **Purge via a sweeper hook calling a CLI (chosen).** It runs where the drop happens and needs no queue. The CLI reuses the port, so it's tested at Seam 1. The alternative, a worker job per dropped database, needs `worker-preview` to notice drops it's no longer attached to. Rejected. Bucket lifecycle rules can't see database drops. Rejected.
- **Upload island.** One `"use client"` leaf: the `fetch` PUT with exactly the signed headers from `requestUpload`, then complete, then polling `GET /api/files/<id>/status` (or 63a's use case through a Server Action) every 2 s, capped at 60 s. Bundle cost stays well under the 170 kB budget.
- The journey doesn't bypass the scan. #63's analysis says it must not exist, so the preview run waits for the real worker.

## Interface needs
```ts
// 63a
storagePrefixForDatabase(name: string): string | null;
ObjectStorage.deletePrefix({ bucket, prefix }): Promise<{ deleted: number }>;
as(actor).requestUpload / completeUpload / getFileDownloadUrl; a status read: as(actor).getFileStatus({ fileId }) (63c adds it if 63a didn't).
// 57b
actorFromRequest(); the sign-in helper for Playwright, tests/e2e/support/{mailbox,accounts}.ts
// 61b
docker/scripts/preview-dropped.d/ hook directory, invoked with the dropped database name as $1.
```

## Residue
- HR-06: non-production R2 bucket, token and CORS `PUT` from preview origins and `shipped-it.dev`. Without it AC 5 can't run.
- HR-08: ClamAV and the scan job; without them files never reach `clean`.
- HR-01 and HR-02: preview auth and the mailbox token for Playwright.
- Hook R2 credentials on the VPS (`/etc/foa/sweeper.env`) fall under HR-08.
- `storagePrefixForDatabase` (63a, done) returns null for any name it doesn't know (including a future fingerprinted `foa_pr_<n>_<fp>`), so purge fails safe; extend its regex in 63a's file if the sweeper's names change.
- Risk to check at build: if 57a's migration fingerprint makes several databases per PR, purge must run only once the PR is closed (all of `foa_pr_<n>*` dropped). Check `sweep-preview-dbs.sh` and record the rule in the PR.

## Test plan
- Seam 1: `src/server/modules/files/purge.test.ts` (ACs 1, 2), `scripts/purge-preview-files.test.ts` (argument parsing and exit codes), `_lib/upload.test.ts` (pure client helpers: header pick, poll schedule).
- Seam 2: `tests/e2e/63-files.spec.ts` (ACs 4–6), written now. Not run: no Postgres server here, and the preview needs HR-01, 02, 06 and 08.
- Gates: `pnpm check`, the build (the page is ƒ under Suspense; public pages stay prerendered), a clean tree.

## Slices
1. Purge core, CLI, hook, seeder, page, island, namespace and journey, in that order inside one slice. The unit is size M, so it gets one slice; each step is proved by its test file above.
