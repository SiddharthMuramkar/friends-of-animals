# Brief 102: logo stamping and shareable certificate image (issue #102, M4)

| | |
|---|---|
| Blocked by | 100b, 100c (and through them 100a, 99a); extras 85a (worker-media, `MediaProcessor`, `file_derivative`), 63a (files), 61a (jobs), 59a (`can()`), 82 (public credit) |
| Size, flags | L · risk K (minors: a child's credit on the card) · brand/legal (registered mark) · metadata leakage · worker skew |
| Keys | **X6** (worker-media Dockerfile target, `docker/workers.yml`: serialize with 100c); also X1 (85a's media fake), H21, H8, H9, H5 |
| Branch | `ticket/102-logo-stamping-and-shareable-certificate` → PR into `M4`. Rebase onto `foa/M4` at build start |
| Head start | ✔ `src/server/modules/stamping/domain/{stamp-plan,logo-choice,settings-key}.ts` + tests (39 cases, `1dc5b0e`) |

## Scope
**In:** the Stamping module: one service that stamps an approved FOA logo on a **derived copy** and writes a new file, for the
variants `gallery`, `gallery_thumb`, `social`, `certificate_share`; the brand-logo registry (4 approved files + checksums);
`MediaProcessor.stampImage` (85a's port, sharp adapter, fake, contract); the `stamp.render` job on 85a's `media` queue;
the certificate share card; `getCertificateShareImage`, `/api/certificates/[id]/share`, the share button on 100c's
`/dashboard/certificates`. **Out:** gallery curation and public URLs/bucket/CDN (`PublicAssetUrl`, 103a); the social queue
(#104); the PDF and its template (100c); revoke/reissue (#101). The consumer that deletes a share image on
`certificate.revoked`/`certificate.reissued` is written by **whichever of #101/#102 merges second** (both wait on 100b+100c).

## Acceptance checks (seam)
1. **Derived copy only** (S1). `requestStampedCopy({ derivativeId, variant: "gallery" })` → drain → the media fake got the
   `file_derivative`'s bytes; the output is a new `file_asset` (purpose `stamped_gallery`, born clean, system-owned); the
   original asset's row and object are unchanged. An original `file_asset` id → `not_a_derived_copy`, no job.
2. **Idempotent** (S1). Request twice, drain twice → one `stamped_derivative` row, one processor call. A changed settings
   key (test registry with another logo checksum) → a second row.
3. **Variant sizes** (unit ✔ + contract). gallery ≤ 2048 long edge, never enlarged; gallery_thumb ≤ 480 with the tiles;
   social 1080×1080 framed on `#FEFAF2`; certificate_share 1080×1350. Fake and sharp outputs equal `planStamp`.
4. **Contrast** (unit ✔ + S1). Fake reporting a dark region → stored `logo_variant = white`; mid/light → `colour`; very light
   → `black`; thumb → `tiles`.
5. **Approved logos only** (unit + contract). `APPROVED_LOGOS` lists exactly the colour, white, black and tiles files with
   SHA-256; a test hashes `public/brand/*` and matches; `loadApprovedLogos()` refuses a file whose hash differs; the adapter
   composites only from that branded set, scaled (no tint/modulate/recolour call; reviewer checks).
6. **No metadata** (contract, real sharp, no Docker). 85a's `fixtures/media/gps.jpg` (EXIF GPS + XMP) through `stampImage`
   for each output type (WebP, JPEG, PNG) → `sharp(out).metadata()` has no `exif`, `xmp`, `iptc`; `exifr` finds no GPS.
7. **Share download** (S1). Participant owner → signed URL (attachment, file name `foa-certificate-<number>.png`, no name);
   guardian of the minor ✓; another participant ✗, coordinator ✗, visitor ✗ (all `not_found`, same shape); revoked or
   superseded → `certificate_not_valid`; no image yet → `{ state: "preparing" }` and one job enqueued (idempotent).
8. **Card content** (S1 + unit). The SVG the fake received shows the public credit (minor `Asha K.`), competition, award
   label, number, issue date (IST) and a QR decoding to `${APP_URL}/verify/<number>` (resvg + 100c's `jsqr`); it has no DOB,
   registration number, school or city (unless opted in). Unit: long titles fit their box; a Devanagari name stays whole.
9. **Prepared on issue** (S1). `certificate.issued` → drain → a `certificate_share` row exists for that certificate.
10. **Runs in worker-media** (static Vitest). `stamp.render` is registered only on the `media` queue; the worker-media
    Dockerfile target copies the 4 logo files and the card fonts (`docker/**/*.test.ts` pattern).
11. **Authz** (S1). `requestStampedCopy`: system ✓, staff_admin ✓, content_manager ✓; participant ✗, visitor ✗.
    `getCertificateShareImage`: as AC 7. `stamp.render` handler: system only.
12. **axe** (S2, written, Not run). `tests/e2e/102-certificate-share.spec.ts`: `/dashboard/certificates` with the share
    button, `expectRendersAccessibly` + one `.dark` run.

## Files
New: `src/server/modules/stamping/{domain/share-card.ts, brand-logos.ts, request.ts, render.ts, share.ts, index.ts}` + tests;
`src/server/db/schema/stamping.ts`; `drizzle/NNNN_102_pre_stamp_purposes.sql` (custom: `ALTER TYPE file_asset_purpose ADD
VALUE` ×3, never used in DDL, F2) + `drizzle/NNNN_102_stamping.sql`; `src/app/api/certificates/[id]/share/route.ts`;
`public/brand/foa-logo-watermark-tiles.png` (generated by `pnpm brand:assets`); `tests/e2e/102-certificate-share.spec.ts`.
Touch: 85a's `src/server/ports/{media,media.contract,media-sharp}.ts` + `src/test/fakes/media.ts` (add `stampImage`; X1);
`Dockerfile` worker-media target + `docker/workers.yml` (**X6**); worker-media job registry (H21); `scripts/brand-assets.ts`
+ `public/brand/README.md` (tiles watermark row); `package.json` (`@resvg/resvg-js` 2.6.2 devDependencies → dependencies,
exact); `src/server/app.ts` (one line); schema barrel (H1); 59a policy table (H8); 61a consumer list (`certificate.issued`,
H9); 100c's `/dashboard/certificates` page + `messages/en-IN/certificates.json` (append keys); data inventory (H5).

## Design (risk-flagged: compared)
**Port.** (A ← chosen) one deep op on 85a's `MediaProcessor`: `stampImage({ source, variant, logos })` → bytes + plan +
chosen logo. Adapter and fake both call the pure `planStamp` + `chooseLogoVariant`, so sizes and choices can't drift (85a's
`planImageDerivatives` precedent); one decode. (B) `measure()` + `composite()` with the use case orchestrating: two decodes,
contrast policy leaks into the handler, the fake must script two calls. (C) a separate `Stamper` port: a second sharp adapter
re-doing decode/encode/strip; the ticket wants "the image processor faked at its port". Deletion test on A: removing it
scatters plan, contrast and encoding over the handler.
**Share card** (spec tournament, P+B2). (a ← chosen) pure `shareCardSvg(model, plan)` (text, QR SVG from 100c, logo area left
empty) → resvg-js with explicit font files (100c's Noto subsets; rustybuzz shapes Devanagari) → sharp stamps the logo.
Deterministic, contract runs in Vitest, no Gotenberg on this path (HR-41 not needed for shares). Cost: no auto-wrap, so
`share-card.ts` fits lines by measured width and shrinks within bounds (tested). (b) HTML via Gotenberg's Chromium
screenshot: reuses 100c's HTML if it went that way and wraps text well, but needs the sidecar, a network hop, and can't run
here. Switch to (b) only if 100c lands HTML + Gotenberg and (a)'s fitting truncates real titles.
**Data.** Own table `stamped_derivative` (id, source_derivative_id null → file_derivative, certificate_id null → certificate,
variant `stamp_variant` {gallery, gallery_thumb, social, certificate_share}, logo_variant `stamp_logo_variant` {colour, white,
black, tiles}, settings_hash, output_file_id → file_asset, width, height, created_at); CHECK `num_nonnulls(source_derivative_id,
certificate_id) = 1` (no enum literal); partial uniques `(source_derivative_id, variant, settings_hash)` and `(certificate_id,
variant, settings_hash)`. Both enums in full now (M34-2). Rejected: `certificate.share_file_id` (H13 says only 100a/#101 change
that table) and 85a's `file_derivative` (access follows the parent; stamped copies need their own purpose).
**Choices.** Each variant is stamped independently from the derivative (`display_1600`), so the thumb gets the tiles instead of
a shrunken wordmark (deviation from the spec's "thumb cut from the stamped output": #17 approves tiles at small sizes). Tiles
are always colour (#17 approved tiles-alone and one-colour separately). Opacity 100%. Outputs flattened onto the background.
Stamped copies go to 63a's configured bucket; the `stamped_` purpose prefix marks them publishable for 103a's public bucket
and fallback route (M34-8); `certificate_share` stays private. Share eager on `certificate.issued`, lazily re-enqueued by
`getCertificateShareImage` when missing or when the card's content (credit) changed (key covers content).

## Interface needs (code against these; adopt the real names at claim)
```ts
// 85a
interface MediaProcessor { processImage(i: MediaInput): Promise<MediaResult>;
  stampImage(i: { source: { kind: "raster"; bytes: Uint8Array } | { kind: "svg"; svg: string; fontFiles: readonly string[] };
    variant: StampVariant; logos: ApprovedLogoSet }): Promise<{ bytes: Uint8Array; contentType: string; plan: StampPlan;
    logoVariant: LogoVariant }> }                       // ← #102 adds stampImage; fake: .stamped[], .regionLuminance = 0.5
type FileDerivative = { id: string; fileAssetId: string; kind: DerivativeKind; storageKey: string; width: number; height: number };
// 63a
storeGeneratedFile(tx: AppDb, ctx: UseCaseContext, i: { purpose: FilePurpose; bytes: Uint8Array; contentType: string;
  filename: string }): Promise<{ fileAssetId: string }>;           // system-owned, born clean (100a asks for it too)
signedFileUrl(ctx: UseCaseContext, i: { fileAssetId: string; disposition: "attachment"; filename: string }): Promise<{ url: string; expiresAt: Date }>;
storage.read({ bucket, key }): Promise<ReadableStream<Uint8Array>>;
// 61a
emit(tx, clock, { type: string; aggregateType: string; aggregateId: string; payload: object }): Promise<void>;
jobs.send("media", "stamp.render", { derivativeId?: string; certificateId?: string; variant: StampVariant }, { singletonKey: string });
// 59a: authorize(ctx, "stamping.request" | "certificate.download", resource) — share follows 100c's PDF download rule
// 100a: certificate { id; number; type; status: "issued" | "revoked" | "superseded"; competitionId; participantProfileId;
//   awardLabel: string | null; issuedAt: Date }; event "certificate.issued" { certificateId }
// 100b/100c: verifyUrlFor(number): string; qrSvg(text: string): string; CERTIFICATE_FONT_FILES: readonly string[]
// 82: resolvePublicCredit(db, { participantProfileId, competitionId, use: "certificate_share" }): Promise<string>
```

## Residue
**HR-43** placement, size, opacity, contrast thresholds, tiles threshold (96 px), tiles never combined with white/black: code
defaults, FOA design sign-off (REL-prod). **HR-35** worker-media must be deployed for any stamp to run. **HR-10/M4**
worker-preview redeploy for `stamp.render`. **HR-41** only if the card switches to Gotenberg (design b). **HR-44** append:
a minor's credit on a share image. **HR-45** append: share-card wording. **HR-31** append: stamped copies and share images
in the data inventory (retention as the source).

## Test plan
Unit ✔ `domain/{stamp-plan,logo-choice,settings-key}.test.ts`; unit `domain/share-card.test.ts`, `brand-logos.test.ts`.
Contract: 85a's `media.contract.ts` gains stamp cases, run by `media-sharp.test.ts` (real sharp + resvg, fixtures) and
`fakes/media.test.ts` (ACs 3, 5, 6). Seam 1 (`createHarness`, PGlite, fake clock, `h.drain()`, media/storage fakes):
`request.test.ts` (1, 2, 4, 11), `share.test.ts` (7, 8, 9, 11). Static: `docker/worker-media-stamp.test.ts` (10).
**Not run:** Seam 2 (no Postgres here; previews fail at `db:migrate`); the worker-media image build; stamping on staging (HR-35).

## Slices (ordered; each one test file)
1. **Stamp op**: brand registry + tiles asset, `stampImage` on the port, sharp adapter (measure, composite, strip), fake,
   contract. ACs 3, 5, 6. `media-sharp.test.ts`.
2. **Stamped copies**: schema + migrations, `requestStampedCopy`, `stamp.render` for photo variants, storage, idempotency,
   authz. ACs 1, 2, 4, 11. `request.test.ts`.
3. **Certificate share**: `share-card.ts`, svg source in the adapter, `certificate.issued` consumer,
   `getCertificateShareImage`, authz. ACs 7, 8, 9, 11. `share.test.ts`.
4. **Edges**: route handler, dashboard button + messages, worker-media registry/Dockerfile/compose, seed, e2e spec.
   ACs 10, 12. `docker/worker-media-stamp.test.ts`.
