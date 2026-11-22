# Brief 100c: certificate template, Gotenberg 9 rendering, participant and guardian downloads (issue #100, M4)

| | |
|---|---|
| Blocked by | 100a (port `PdfRenderer`, `CertificateDocument`, `certificate.render` handler, stored PDFs). Also on its milestone: 85a (worker-media + media queue), 63a (signed URLs), 81a (guardian links), 59a `can()` |
| Size, flags | L · risk (A: download authz on children's PDFs; K: minors) · infra (Gotenberg sidecar, worker skew) · new dependencies (QR encoder; test-only `jsqr`) |
| Keys | **X6** (`docker/workers.yml`, `docker/README.md`, Dockerfile worker-media target). Also serial: `package.json` + lockfile, `src/env.schema.ts` |
| Branch | `ticket/100-pdf` → PR into `M4`, title `M4 #100: Certificates with QR verification (PDF)` |
| Head start | none: the template depends on HR-42 copy and the adapter on Gotenberg 9's live docs. Not stretched |

## Scope
In (100c): the certificate template (HTML + CSS, A4 landscape, logo master from `public/brand/`, sample signatory) built from
`CertificateDocument`; the QR SVG of `verifyUrl` (new dependency, exact pin, licence in PR); the Gotenberg 9 adapter of
`PdfRenderer` (worker-media only); routing `certificate.render` to worker-media; the `gotenberg` compose service (exact tag
≥ 9.8.0, internal network, limits) and `GOTENBERG_URL` (worker env only); fonts for non-Latin names; use cases
`listMyCertificates` and `getCertificateDownloadUrl`; route `/api/certificates/[id]/pdf`; page `/dashboard/certificates`.
- **100a owns:** issuing, numbers, the port + fake + contract, the render handler, storage of the PDF, render status, admin list.
- **100b owns:** `/verify` and the lookup the QR points at.
- **Out:** coordinator ZIP and revoke/reissue (#101), share image (#102: reuses this unit's `qrSvg`).

## Acceptance criteria (numbered, with seam)
1. **Download, allowed** (S1, ticket AC 4). For a rendered certificate: the participant themself and the guardian of that child
   (active link) get `{ url, expiresAt }` from `getCertificateDownloadUrl({ certificateId })`; URL is a storage-fake signed GET,
   `disposition: attachment`, filename `<number>.pdf`, ≤ 5 min; one audit row `certificate.downloaded`.
2. **Download, refused** (S1). Another participant, another family's guardian, a revoked-link guardian, the student's coordinator
   (until #101's ZIP), staff (ticket: "nobody else"), a visitor → `forbidden`. An unknown id → `forbidden` too, so ids can't
   be probed (`can()` runs first and finds no owner). Allowed caller, pending/failed render → `not_ready`.
3. **Route** (S1-adjacent unit on `_lib`, S2 written). `/api/certificates/[id]/pdf`: `await connection()`, actor from request,
   use case, 302 to the signed URL with `Cache-Control: no-store`; `forbidden` → 403 page-less response; `not_ready` → 409.
4. **Dashboard list** (S1). `listMyCertificates()` → participant: own certificates; guardian: one group per linked child; each
   item: number, type, award, competition, issued on, `downloadable` (rendered and issued). No other child's rows.
5. **Template** (unit). `certificateHtml(doc)` contains the escaped name (a `<script>` name stays text), number, competition,
   type wording from `messages/en-IN/certificatePdf.json`, the logo master inline, the "sample" signatory marker, and an inline
   QR SVG; no external URL at all (fonts and images inlined), so Gotenberg needs no network.
6. **QR decodes** (unit, ticket AC 2). Rasterise the template's QR SVG with `@resvg/resvg-js`, decode with `jsqr` →
   exactly `doc.verifyUrl`.
7. **Devanagari** (unit + residue). A name `आशा राव` reaches the HTML intact with `lang` set; the font stack names a Noto
   Devanagari face present in the Gotenberg 9 image (verify the image's font list from its Dockerfile at build time); if absent,
   embed an OFL Noto Sans Devanagari subset as a PDF-only asset and ask for a ruling (UI rule "never add a font" is about web
   fonts; record the reading in the PR).
8. **Adapter** (unit, contract). `gotenbergPdfRenderer({ baseUrl, fetch })` posts multipart to the Chromium HTML route with
   `index.html` and paper/margin/background fields as Gotenberg 9 documents them (verify live: Context7 or gotenberg.dev; never
   from memory); returns bytes starting `%PDF-`; non-2xx → `PdfRenderError` with status; timeout → `PdfRenderError`. Runs 100a's
   `pdf.contract.ts` against a recorded fake `fetch` (no network).
9. **Routing** (unit). The worker-media job registry handles `certificate.render`; the general worker never does (85a's queue).
10. **Compose** (unit text check in `docker/workers.test.ts`). `gotenberg` service: image `gotenberg/gotenberg:9.<x>.<y>` exact tag
    ≥ 9.8.0, no published ports, worker-media network only, cpus/mem/pids limits, healthcheck on `/health`, `restart:
    unless-stopped`; worker-media has `GOTENBERG_URL=http://gotenberg:3000`. Never `docker compose down -v`.
11. **axe** (S2, written, Not run). `tests/e2e/100-certificates-dashboard.spec.ts`: `/dashboard/certificates` (participant with
    certificates, guardian with two children, empty state) via `expectRendersAccessibly` + `.dark`.

## Files
New: `src/server/modules/certificates/{template/certificate-html.ts, template/qr.ts, downloads.ts}` + tests,
`src/server/adapters/pdf-gotenberg.ts` + test (or under worker-media's folder per 85a), `src/app/api/certificates/[id]/pdf/route.ts`
+ `_lib`, `src/app/dashboard/certificates/{page.tsx,_components/*}`, `messages/en-IN/{certificates,certificatePdf}.json`,
`tests/e2e/100-certificates-dashboard.spec.ts`.
Touch: `docker/workers.yml`, `docker/README.md` (X6), worker-media entry/registry (85a), `src/env.schema.ts` (`GOTENBERG_URL`,
worker-only, optional outside the production worker), `package.json` + lockfile (QR encoder; `jsqr` dev), `pnpm-workspace.yaml`
`allowBuilds` only if a dep has an install script (pick one without), H3 `messages.ts`, H8 `can()`, H26 dashboard nav, `src/lib/app-routes.ts`.

## Design (risk-flagged: two template technologies compared)
- **A. HTML/CSS → Gotenberg Chromium ← chosen.** Chromium shapes Devanagari and other scripts correctly, uses the image's
  fonts, prints CSS `@page` A4 landscape; the template is a pure `certificateHtml(doc)` function, testable without Gotenberg.
  Cost: PDFs are not byte-deterministic (Gotenberg stamps dates) — acceptable, the fake is deterministic.
- **B. SVG template → resvg/Gotenberg.** Deterministic and small, but resvg's complex-script shaping and line breaking are weak
  for Devanagari names, and the QR + text layout would be hand-positioned. Rejected on the Devanagari fixture.
- **Downloads**: one use case `getCertificateDownloadUrl` (can → status gate → presign → audit); the route is a thin adapter.
  `can()` rule `certificate.download`: owner (participant profile's user) or active guardian of that profile; no staff rule.
- QR encoder candidates: `uqr` (MIT, zero deps, SVG output) or `qrcode` (MIT, deps). Prefer `uqr` if ≥ 2 weeks old and no
  install script; error-correction level M; margin 4 modules.

## Interface needs (code against these; adopt real names at claim)
```ts
// 100a
interface PdfRenderer { render(job: { template: "certificate"; version: number; data: CertificateDocument }): Promise<Uint8Array> }
type CertificateDocument = { number: string; type: CertificateType; awardPosition: number | null; awardLabel: string | null;
  recipientName: string; competition: { code: string; name: string }; issuedOn: { year: number; month: number; day: number };
  verifyUrl: string; signatories: { name: string; title: string; sample: boolean }[] };
class PdfRenderError extends Error { status?: number }   // from ports/pdf.ts; pdfRendererContract(name, setup) in pdf.contract.ts
certificate: PgTable<{ id; number; status; renderStatus; pdfFileId; participantProfileId; ... }>;
// 63a: ObjectStorage.presignGet({ bucket; key; expiresInSeconds; contentType; disposition; filename }); file_asset row by id
// 81a: activeGuardianLinks(db, { guardianUserId }): Promise<{ participantProfileId: string }[]>; profile.userId (self)
// 85a: worker-media job registry: registerMediaJob("certificate.render", handler) / queue "media"
// 59a: authorize(ctx, "certificate.download", { participantProfileId }); recordAudit(...)
// 57b: actorFromRequest(req): Promise<Actor>
```

## Residue
HR-41 (owner deploys Gotenberg 9 beside worker-media from the committed compose file; until then previews have no PDFs) ·
HR-42 (artwork, wording, signatories, signature images; ships with a "sample" signatory) · HR-10/M4 (worker-preview redeploy) ·
HR-30 (children's PDFs in storage; residency) · font ruling if Gotenberg's image lacks Devanagari.

## Test plan
Unit: `template/certificate-html.test.ts` (AC 5, 7), `template/qr.test.ts` (AC 6, resvg + jsqr), `pdf-gotenberg.test.ts`
(AC 8, contract with fake fetch), routing (AC 9), `docker/workers.test.ts` additions (AC 10). Seam 1: `downloads.test.ts`
(AC 1, 2, 4) on `createHarness` + 100a seed builders + storage fake. Route `_lib` unit (AC 3). Seam 2 written, Not run;
Gotenberg itself not run here (no docker): listed under "Not run".

## Slices (ordered)
1. **Template + QR**: `certificateHtml`, `qrSvg`, messages, QR dependency + `jsqr`. AC 5, 6, 7. `template/*.test.ts`.
2. **Gotenberg adapter + worker-media wiring + compose/env**: AC 8, 9, 10. `pdf-gotenberg.test.ts`, `docker/workers.test.ts`.
3. **Downloads**: `getCertificateDownloadUrl`, route, `can()` rule, audit. AC 1, 2, 3. `downloads.test.ts`.
4. **Dashboard**: `listMyCertificates`, page, nav link, e2e spec. AC 4, 11. `downloads.test.ts` (list block).
