# Brief 85a: image derivatives and metadata stripping (worker-media)

Issue #85 · M2 · branch `ticket/85-derivatives` · worktree `/root/foa-wt/85a` · base `foa/M0` 442dd99 · L · risk K V · key X6
Blocked by 63b (and through it 63a, 61a, 59a, 57a). Lands before **85b**, which owns everything about Entries.
Head start on the branch: `src/server/modules/files/domain/{derivatives,image-type}.ts` + tests (pure, green).

## Scope
**In (85a):** the media half of the Files module.
- `MediaProcessor` port: bytes in, derivatives out. A sharp adapter (prebuilt sharp; HEIC decoded by WASM libheif first),
  an in-memory fake, and one contract suite both pass.
- The derivative registry `DERIVATIVE_KINDS` (`thumb_320`, `display_1600`, WebP), a code registry of which file purposes
  get derivatives, and the `file_derivative` and `file_processing` tables.
- The `processImageAsset` job on a dedicated pg-boss queue `media`, triggered once a scan marks an asset clean. It writes
  derivatives to storage and rows to the DB, and emits `file.processed` or `file.processing_failed`.
- Signed delivery of a derivative (`getFileDerivativeUrl`), authorised by the parent asset's `can()` rule. Originals stay private.
- `worker-media` process, Dockerfile target and compose service with `cpus`/`mem_limit`/`pids_limit`, plus README docs.

**Out:** the Entries module, the `entry_image` purpose value, every page and message, confirmation, Entry ID (all **85b**).
Video transcode and poster (86a), PDF clean copies (86b), stamping (#102). Never flip `allowBuilds: sharp` (R3).

## Acceptance checks (85a's share of #85)
1. **HEIC accepted.** The sharp adapter decodes the committed `fixtures/media/iphone.heic`. It returns `thumb_320` and
   `display_1600` WebP whose sizes equal `planImageDerivatives(source)`. *Seam: adapter contract (Vitest, no Docker).*
2. **No EXIF location or camera data.** For `gps.jpg` and `iphone.heic`, `exifr.parse(derivative, {gps, tiff, xmp, iptc})`
   finds no GPS, Make, Model, XMP or IPTC. *Contract.*
3. **Orientation baked.** `rotated.jpg` (Orientation 6) gives portrait derivatives with no Orientation tag. *Contract.*
4. **Bad input is typed.** Corrupt bytes give `MediaError` `media_decode_failed`. GIF, AVIF or any non-image gives
   `unsupported_type`. The decoder is picked by `sniffImageType`, never by the declared type. *Contract (fake and real).*
5. **Pipeline after the scan.** A clean asset whose purpose has derivatives: after `drain()` there is one `file_derivative`
   row per kind, objects in the storage fake, `file_processing.status = done` and a `file.processed` outbox row.
   If the media fake fails, the result is `failed` with the error code and a `file.processing_failed` event. A purpose with
   no derivatives queues no job. *Seam 1.*
6. **Nothing before the scan.** No media job runs for an asset that is unscanned or quarantined. *Seam 1.*
7. **Derivative delivery authz.** The owner and a staff admin get a signed derivative URL. Another member is refused, and
   everyone is refused for a quarantined asset. The URL is refused after `clock.advance(ttl + 1 s)`. *Seam 1.*
8. **Idempotent.** Draining the same media job twice leaves one row per kind and one event. *Seam 1.*
9. **Service limits.** `worker-media` in the compose file has cpus/mem/pids limits and consumes only the `media` queue
   with concurrency 1 and a per-job timeout. *Vitest static check on the YAML (the `docker/**/*.test.ts` pattern).*

## Files
- New: `src/server/ports/media.ts`, `media.contract.ts`, `media-sharp.ts` (+ `.test.ts`); `src/test/fakes/media.ts` (+ test);
  `src/server/db/schema/media.ts`; `src/server/modules/files/{process-image,derivative-url}.ts` (+ tests);
  `src/worker-media/main.ts`; `fixtures/media/{gps.jpg,rotated.jpg,iphone.heic,corrupt.jpg,README.md}` (provenance and licence).
- Touch (hotspots): `src/server/deps.ts` + `src/test/harness.ts` (append `media`, **X1**); the schema barrel (one line, H1);
  `drizzle/` (one generated migration `85_derivatives`, H2); `Dockerfile` target, `docker/workers.yml` + `docker/README.md`
  (**X6**, H28: serialize with 61b, 63b, 66b, 68); `package.json` + lockfile (H29); `vitest.config.ts` only if the fixtures
  path needs it (X1). Append the scan-clean hook in 63b's consumer and a purpose-registry entry in 63a's module.
- H21: 85a owns the derivative kinds and the media job registry. 86a, 102, 103 and 129 append to them.

## Design (risk-flagged: compared 3 ways)
- **HEIC route.** (a) A worker-media image with global libvips+libheif+libde265, sharp built from source in that image only.
  It's fast, but it can't be tested here or in CI (prebuilt sharp has no HEVC, and Docker isn't allowed), so AC 1 would be
  proven only on the VPS. (b) **Chosen:** a WASM decoder (`heic-decode`, libheif-js) gives RGBA, and prebuilt sharp encodes.
  The same code runs in Vitest, CI and the image, which meets F3's "runnable by `pnpm test` without Docker". It's slower and
  uses about 50 MB of RAM for a 12 MP frame: fine at concurrency 1. (c) ffmpeg decode: poor HEIF tile-grid support, needs
  the binary, and EXIF orientation is awkward. The port keeps (a) a drop-in swap if production CPU says so.
- **Port shape.** `processImage(bytes, {kinds})` with bytes in and bytes out (**chosen**: deep, no storage coupling, the
  contract runs on fixture bytes) vs `processImage({key})` doing storage I/O itself. The job handler does the storage I/O.
- **Sizes have one source of truth.** `planImageDerivatives` decides the sizes. The adapter resizes to exactly them
  (`fit: "fill"` on already-proportional sizes), so the fake and the real adapter report identical dimensions.
- **Derivative storage.** A `file_derivative` table (**chosen**: unique `(file_asset_id, kind)`, access follows the parent)
  vs derived `file_asset` rows with a self-FK (muddles #63's status and purpose enums and invites R2 enum hazards).
- **Processing state.** A new `file_processing` table with its own enum (`queued | done | failed`, `error_code`, `attempts`)
  (**chosen**: no edit to #63's `file_asset_status`, which would be an R2 hazard) vs new `file_asset_status` values.

```ts
// src/server/ports/media.ts
export type MediaInput = { bytes: Uint8Array; kinds: readonly DerivativeKind[] };
export type MediaResult = { sniffedType: SniffedImageType; source: PixelSize & { orientation?: number };
  derivatives: Array<PlannedDerivative & { bytes: Uint8Array }> };
export interface MediaProcessor { processImage(input: MediaInput): Promise<MediaResult> } // rejects with MediaError
export class MediaError extends Error { code: "media_decode_failed" | "unsupported_type" }
// fake: new FakeMediaProcessor({ source?: PixelSize }).failNext(n, code); .processed (inputs seen)
```

## Interface needs (what 85a codes against; adopt the real names at claim)
```ts
// 63a: ObjectStorage port + file_asset
interface ObjectStorage { put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>; presignGet(key: string, ttlSeconds: number): Promise<string> }
type FileAsset = { id: string; ownerUserId: string; purpose: FileAssetPurpose; storageKey: string; contentType: string;
  status: "pending_upload" | "uploaded" | "scanning" | "clean" | "quarantined" | "deleted" };
function derivedKey(asset: FileAsset, kind: DerivativeKind): string; // same env prefix as the original
// 63b: the scan job's outcome, emitted in its transaction
type FileScanned = { type: "file.scanned"; aggregateId: string /* fileAssetId */; payload: { result: "clean" | "infected" } };
// 61a: outbox + jobs
function emit(tx: AppDb, event: { type: string; aggregateType: string; aggregateId: string; payload: object }): Promise<void>;
interface JobQueue { send(queue: "media", name: "processImageAsset", data: { fileAssetId: string },
  opts?: { singletonKey?: string }): Promise<void> }
// 59a: policy + audit
function can(actor: Actor, action: "file.read", resource: { type: "file_asset"; id: string; ownerUserId: string }): Promise<boolean>;
```
If 61b hasn't shipped the worker entrypoint pattern by claim, 85a adds `src/worker-media/main.ts` alone and records it.

## Residue
- **HR-35**: deploy `worker-media` with the limits; HEIC and EICAR smoke upload on staging (owner, VPS).
- **HR-06, HR-08** (shared with #63): the non-prod bucket and ClamAV, needed before a preview upload ever gets derivatives.
- **HR-31**: retention for derivatives (proposed: same as the original). **HR-36**: a licence note for libheif/libde265
  (LGPL, WASM, server-side) and HEVC decode, next to the ffmpeg note.
- Fixture provenance: `iphone.heic` must be openly licensed with GPS EXIF and no person in it (CC0, or a test asset under
  ISC/MIT such as heic-decode's own). If none carries GPS, inject GPS with sharp `withExif` into a JPEG fixture and keep
  the HEIC check to "no EXIF at all". Record the source in `fixtures/media/README.md`.

## Test plan
- Contract suite `media.contract.ts`, run by `media-sharp.test.ts` (real fixtures) and `fakes/media.test.ts`: ACs 1-4.
- Pure: `domain/derivatives.test.ts`, `domain/image-type.test.ts` (done).
- Seam 1 (`createHarness`, storage, scanner and media fakes, `drain()`): `process-image.test.ts` (ACs 5, 6, 8) and
  `derivative-url.test.ts` (AC 7, authz table).
- Static: `docker/worker-media.test.ts` (AC 9).
- **Not run:** the Docker image build and run; HEIC on staging (HR-35); Seam 2 (none needed; 91b's journey covers it).

## Slices
1. Port, fake and contract with the JPEG/PNG/WebP sharp adapter: metadata strip, orientation, typed errors (`media-sharp.test.ts`).
2. HEIC through the WASM decoder, plus the fixtures and their README (`media-sharp.test.ts`, HEIC cases).
3. Schema, the scan-clean hook, the `processImageAsset` job, outbox events, `media` in Deps and the harness (`process-image.test.ts`).
4. Signed derivative delivery and its authz (`derivative-url.test.ts`).
5. `worker-media` entrypoint, Dockerfile target, compose service with limits, README (`docker/worker-media.test.ts`).
