# Brief 63a: private files, storage port, presign, signed delivery

Unit 63a of #63 (M0). Branch `ticket/63-storage`, worktree `/root/foa-wt/63a`. L, risk (A K V), keys X1 X4.
Blocked by 59a (`can()`, roles, audit) and 61a (outbox `emit`, drain). PR base `M0`, title `M0 #63: Private file uploads with malware scan and signed delivery (storage)`.

## Scope
**In (63a):** the Files module core that every later upload uses.
- `file_asset` table and two enums; the purpose registry (types and size per purpose); storage key layout, **including the per-environment prefix** (`storagePrefixFor`); the reverse map from a preview database name to its prefix (63c's purge reads it).
- `ObjectStorage` port: R2 adapter, in-memory fake, shared contract suite, and an `unconfiguredStorage` default that refuses (like `unconfiguredEmailSender`).
- Use cases `requestUpload`, `completeUpload`, `getFileDownloadUrl`. `completeUpload` emits `files.file_uploaded` in its transaction. 63b consumes it.
- Thin route handlers: `POST /api/files`, `POST /api/files/[id]/complete`, `GET /api/files/[id]` (302 to the signed URL, `no-store`).
- `can()` rules `file.upload` and `file.read`; deps and harness wiring (X1); optional storage env vars, required only in production.
- **Pure core on the branch (6a0adde)**, `src/server/modules/files/domain/`: `file-status.ts` (`FILE_STATUSES`, `nextFileStatus`), `purposes.ts` (`FILE_PURPOSES`, `PURPOSE_RULES`, `checkUploadRequest`, `checkStoredObject`, `normaliseContentType`), `delivery.ts` (`deliveryDecision`, `dispositionFor`, `downloadFilenameFor`) and `storage-key.ts` (`storagePrefixFor`, `storagePrefixForDatabase`, `storageKeyFor`, `quarantineKeyFor`). Build the pg enums from `FILE_STATUSES` and `FILE_PURPOSES` so they can't drift. Use cases call these functions; don't re-implement them.

**Out:** 63b owns the scanner port, ClamAV adapter and sidecar, the scan job, quarantine and magic-byte sniffing. 63c owns purge on preview drop (sweeper hook), the `/account/files` demo page, the `files` namespace UI and the Seam 2 journey. #85 owns derivatives and metadata stripping. #68 owns backup.

Prefix derivation moved here from 63c's title: 63a writes keys from day one, and the forward and reverse maps must agree, so they live in one file.

## Acceptance criteria (numbered, with seam)
1. **Round trip** (seam1). `as(member).requestUpload({purpose:"test_upload", contentType:"image/png", sizeBytes:1234})` returns `{fileId, uploadUrl, headers, expiresAt}`. The row is `pending_upload`. `h.storage.put(uploadUrl, bytes, headers)` succeeds. `completeUpload({fileId})` sets `uploaded` and writes one `files.file_uploaded` outbox row in the same transaction. After the 63b stub marks it clean (or `status` is set to `clean` directly in this unit's test), `getFileDownloadUrl` returns a URL whose `h.storage.get(url)` yields the same bytes.
2. **Authorization** (seam1, table-driven). For a `clean` file, the owner and `staff_admin`/`super_admin` get a URL. Another member and a visitor get `forbidden`. A non-owner staff read writes one `audit_log` row (`file.read`). A visitor can't `requestUpload`.
3. **Pre-scan gate** (seam1). `can()` runs first, so a caller it refuses gets `forbidden` whatever the status. For allowed callers: at `uploaded` or `scanning` the owner gets a URL and staff get `file_not_ready`. At `quarantined`, `rejected` or `deleted` everyone gets `file_unavailable`, owner and super admin included. At `pending_upload` everyone gets `file_not_ready`. The decision table is done in `domain/delivery.ts`.
4. **Expiry** (seam1). A URL from `getFileDownloadUrl` works at `+299 s` and is refused at `clock.advance(300 s + 1 ms)` (`expired`). An upload URL is also refused after its 10-minute expiry.
5. **Limits at presign** (seam1). A size over the purpose max, a size of 0, a type outside the purpose list, and an unknown purpose are refused with `too_large`, `empty`, `type_not_allowed` and `invalid_input`, and no row is written. `test_upload` is refused in production (`purpose_unavailable`).
6. **Limits after upload** (seam1). If the stored object's `HEAD` size or type differs from the declared ones, `completeUpload` deletes the object, sets `rejected` and emits nothing. A missing object gives `upload_missing` and the row stays `pending_upload`. Calling `completeUpload` twice is idempotent (one outbox row). A non-owner calling it is `forbidden`.
7. **Keys** (unit). The key is `<prefix><purpose>/<uuidv7>` and never holds user input. The prefix is `""` in production, `staging/`, `local/`, `pr-<n>/` or `br-<hash8>/`. The reverse map gives `foa_pr_12` → `pr-12/`. **Done (pure core).**
8. **Contract** (seam1). `objectStorageContract` runs against the fake. The R2 adapter runs it only under `R2_CONTRACT=1` (manual, Not run).

## Files
- New: `src/server/db/schema/files.ts`, plus one barrel line (hotspot, `merge=union`). One generated migration `--name 63_file_asset`: no custom SQL, regenerated in the merge queue.
- New: `src/server/modules/files/{index.ts,use-cases/*.ts,errors.ts,policy.ts}` and `domain/*` (exists).
- New: `src/server/ports/{storage.ts,storage.contract.ts,storage-r2.ts}`, `src/test/fakes/storage.ts` (+test).
- New: `src/app/api/files/route.ts`, `src/app/api/files/[id]/route.ts`, `src/app/api/files/[id]/complete/route.ts`.
- Touch (X1): `src/server/deps.ts` (add `storage: ObjectStorage` and `files: { bucket, keyPrefix }`), `src/test/harness.ts` (append `storage: FakeStorage`).
- Touch: `src/server/app.ts` (one `filesUseCases` line), 59a's policy table (append rules), `src/env.schema.ts` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, all optional unless `APP_ENV=production`), `.env.example`, `package.json` and the lockfile (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, exact pins).
- X4: touch `next.config.ts`/CSP only if #65 has landed: add the R2 origin `https://<account>.r2.cloudflarestorage.com` to `connect-src` through #65's source registry. Otherwise leave it and note it in the PR for #65. No `remotePatterns`: private originals never go through `next/image`.

## Design (compared with codebase-design vocabulary)
- **A. Thin S3-shaped port + deep Files module (chosen).** `ObjectStorage` holds only storage verbs. Keys, limits and gates live in the module. The adapter is shallow, so moving to S3 Mumbai is an endpoint and credentials change. The fake is small and faithful, and the contract keeps it honest.
- **B. Deep storage port** (`createUpload(purpose, owner)` inside the adapter). It leaks domain rules into every adapter and duplicates them in the fake. Rejected.
- **C. Streaming delivery proxy** through a Vercel function. Vercel caps response bodies at 4.5 MB and it costs CPU per byte. Rejected for a 302 to a 5-minute presigned GET with `response-content-disposition` (inline for images and PDF, attachment otherwise) and `response-content-type` = the stored type.
- Quarantine stays **status-gated**. The gate is authoritative; 63b may also move the object under `quarantine/`.
- R2 has no POST policy, so `content-type` and `content-length` are **signed into the PUT**. A `HEAD` check runs on complete, and 63b sniffs magic bytes.
- **Purpose is a pg enum.** `file_asset_purpose` starts with `test_upload`; each later module adds a value in its own migration (F2). The registry in `domain/purposes.ts` holds the types, the max size and the environments allowed.
- No original filename is stored (privacy). The download name is `<purpose>-<id8>.<ext>`.

```ts
export interface ObjectStorage {
  presignPut(i: { bucket: string; key: string; contentType: string; contentLength: number; expiresInSeconds: number }): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(i: { bucket: string; key: string; expiresInSeconds: number; contentType: string; disposition: "inline" | "attachment"; filename: string }): Promise<{ url: string }>;
  head(i: { bucket: string; key: string }): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  read(i: { bucket: string; key: string }): Promise<ReadableStream<Uint8Array>>;   // 63b scans through it
  move(i: { bucket: string; from: string; to: string }): Promise<void>;               // 63b quarantine
  delete(i: { bucket: string; key: string }): Promise<void>;
  deletePrefix(i: { bucket: string; prefix: string }): Promise<{ deleted: number }>;  // 63c purge; refuses "" and prefixes without a trailing "/"
}
```
Schema: `file_asset(id uuid pk, owner_user_id uuid not null → user, purpose file_asset_purpose, content_type text, size_bytes bigint check > 0, bucket text, storage_key text unique, status file_asset_status default 'pending_upload', sha256 text null, scan_result text null, scanned_at, uploaded_at, created_at, updated_at timestamptz)`, with an index on `(owner_user_id, created_at desc)`. The status enum: `pending_upload, uploaded, scanning, clean, quarantined, rejected, deleted`.

## Interface needs (what 63a codes against)
```ts
// 59a: policy (57a stub internals filled by 59a; signature fixed)
can(actor: Actor, action: "file.upload"): Promise<boolean>;
can(actor: Actor, action: "file.read", resource: { type: "file"; id: string; ownerUserId: string }): Promise<boolean>;
// 63a appends the rules: upload = any user actor; read = owner OR global role in {staff_admin, super_admin}.
AuditLog.write(tx: AppDb, e: { actor: Actor; action: "file.read"; entityType: "file_asset"; entityId: string; before: null; after: null }): Promise<void>;
h.seed.member(): Promise<User>;  h.seed.withRole(user: User, role: "staff_admin" | "super_admin"): Promise<void>;
h.userActor(user: User): Actor;  // or 57b's h.signIn(user)
// 61a: outbox
emit(tx: AppDb, e: { type: "files.file_uploaded"; aggregateId: string; payload: { fileId: string } }): Promise<void>;
// 57b: route handlers
actorFromRequest(req: Request): Promise<Actor>;  // session + x-forwarded-for + user-agent
```
If a name differs when the blockers land, adapt the call site. Never wrap a blocker's API.

## Residue
HR-11 (production domain, for CORS origins); HR-13 (FOA's production R2 buckets and tokens; until then production storage is `unconfiguredStorage` and refuses); HR-30 (counsel: children's files on R2 or S3 Mumbai, which the port keeps a config change). HR-06 (non-production buckets) gates only 63c's journey.

## Test plan
- Unit (exists): `domain/*.test.ts`.
- Seam 1: `src/server/modules/files/upload.test.ts` (ACs 1, 5, 6), `delivery.test.ts` (2, 3, 4), and `src/test/fakes/storage.test.ts` running the contract (8).
- The harness `FakeStorage` exposes `put(url, bytes, headers)` and `get(url)`, as a browser would use them. Both check the signature, the method, the signed headers and the expiry against the fake clock.
- Gates: `pnpm check`; the build with empty DB URLs (the routes call `await connection()`); a clean tree. Not run: R2 contract (needs HR-06), Seam 2 (63c).

## Slices
1. Schema, migration, `ObjectStorage` + `FakeStorage` + contract (AC 8): `src/test/fakes/storage.test.ts`.
2. `requestUpload` and `completeUpload` with limits, HEAD check and the outbox emit (ACs 1, 5, 6): `upload.test.ts`.
3. `getFileDownloadUrl`: the gate, `can()`, audit and expiry (ACs 2, 3, 4): `delivery.test.ts`.
4. The R2 adapter, env schema, `productionDeps` wiring, the three route handlers and the build gate: `src/server/ports/storage-r2.test.ts` (pure request-shape tests) plus a build check.
