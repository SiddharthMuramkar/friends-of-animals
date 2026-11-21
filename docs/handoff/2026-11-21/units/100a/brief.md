# Brief 100a: certificates module: eligibility, issuing, numbers, validity (issue #100, M4)

| | |
|---|---|
| Blocked by | 99a (`results.published`, release snapshot), 91a (shortlist-only scope). Through them: 57a 59a 60 61a 63a 69 73 75b 78 81b 85b 89b 97 |
| Size, flags | L · risk (A: authz on children's data; K: minors) · F2 (three enums in full, `file_asset_purpose` value in its own migration) |
| Keys | none listed, **but 100a must hold X1**: it adds `pdf: PdfRenderer` to `src/server/deps.ts` and `FakePdfRenderer` to `src/test/harness.ts` |
| Branch | `ticket/100-module` → PR into `M4`, title `M4 #100: Certificates with QR verification (module)` |
| Head start | `69df159` on `ticket/100-module` (base `foa/M0` 442dd99): `src/server/modules/certificates/domain/{number,status,eligibility}.ts` + tests, 98 tests, `pnpm check` green. New files only: rebase onto `foa/M4` when the build starts. `number.ts` keeps a private IST-year line; switch it to #78's `indianDateAt` once that has landed. Build numbers with #73's `withUniqueCode({ format: certificateNumberFormat(now), constraint })` |

## Scope
In (100a): enums `certificate_type`, `certificate_status`, `certificate_render_status` (full sets); table `certificate`; the
`file_asset_purpose` value `certificate_pdf` (own custom migration, never used in DDL); the `results.published` consumer that runs
`issueCertificates`; numbers `FOA-C-{YY}-{10}`; the validity machine; the `PdfRenderer` **port**, `unconfiguredPdfRenderer`
(production app) and `FakePdfRenderer` (harness); the `certificate.render` handler (port → storage → `rendered`, retries,
`failed`); `certificates.ready` per recipient; `listCertificates` + `retryCertificateRender` + `/admin/certificates`; seed.
- **100b owns:** `verifyCertificate` (public), rate limit, `/verify` and `/verify/[number]`, the no-PII view. It reuses
  `normaliseCertificateNumber` and `verifyPathFor` from this unit's `domain/number.ts` (already built here).
- **100c owns:** the certificate HTML template, the QR SVG (new QR dependency) and test-only `jsqr`, the Gotenberg 9 adapter
  of `PdfRenderer`, worker-media routing of `certificate.render`, compose + env (X6), fonts, `listMyCertificates`,
  `getCertificateDownloadUrl`, `/api/certificates/[id]/pdf`, `/dashboard/certificates`.
- **Out:** revoke/reissue/ZIP (#101; columns added here), share image (#102), volunteer certificates (#124; enum value here).

## Acceptance criteria (numbered, with seam)
1. **Issuing set** (S1, table-driven). World: 6 registrations (2 adult individuals, 1 minor individual, 3 institution students in
   a shortlist-only competition incl. one without a digital entry), school positions, a final-round snapshot with 1 winner,
   1 runner-up, 1 finalist. Emit `results.published`, `h.drain()` → exactly the expected `(registration, type, round)` set:
   participation per took-part rule, `school_merit` with `award_position` per school position, `winner`/`runner_up`/`finalist`
   from the snapshot (winner gets winner, not finalist too), special mention → participation only, withdrawn/disqualified → none.
2. **Numbers** (S1 + unit). Every number matches `^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$`, YY = IST issue year (fake clock at
   31 Dec 18:31Z → next year), unique; a forced collision (fixed random source) retries and still stores. Unit: `number.test.ts` ✔.
3. **Idempotent** (S1). Drain again and call the consumer by hand again → no new rows, no new outbox events.
4. **Validity machine** (unit ✔ + S1). Transition table: `(none)→issued` allowed; `issued→revoked`, `issued→superseded` allowed
   (used only by #101's use cases); everything out of `revoked`/`superseded` forbidden; render machine
   `pending→rendered|failed`, `failed→pending` (admin retry), `rendered` terminal. Render state never changes validity.
5. **Render path** (S1). After issuing + drain, `h.pdf.rendered` holds one call per certificate with template `certificate`,
   the name snapshot, number and `verifyUrl = ${APP_URL}/verify/<number>`; the PDF is stored (storage fake) as a `file_asset`
   with purpose `certificate_pdf`; `render_status = rendered`, `pdf_file_id` set. `h.pdf.failNext(3)` → after 3 drains
   `failed`, certificate still `issued`; `retryCertificateRender` → `pending` → drain → `rendered`.
6. **Ready message** (S1). When a recipient's last certificate of a release renders: one `certificates.ready` event; drain →
   adult gets it; a minor's guardian gets it and the child does not (#81 routing). Re-render sends nothing new.
7. **Admin list** (S1). `listCertificates({ competitionId, renderStatus? })` returns number, type, status, render status,
   issued at; no DOB, no contact data.
8. **Authz** (S1), every use case: `listCertificates`/`retryCertificateRender`: staff_admin ✓, competition_manager of that
   competition ✓ (second factor per #60); content_manager ✗, participant ✗, coordinator ✗. Consumer and render handler: system
   actor only; a user calling `issueCertificates` ✗.
9. **Audit** (S1). Issuing writes one audit row per run (counts, release id); retry writes one row.
10. **Seed** (S1 `seed.test.ts`). Preview seed adds a published competition with issued, rendered certificates (one minor,
    one adult, one with a Devanagari name); idempotent.
11. **axe** (S2, written, Not run). `tests/e2e/100-certificates-admin.spec.ts`: `/admin/certificates` with
    `expectRendersAccessibly` + one `.dark` run.

## Files
New: `src/server/modules/certificates/{domain/{number,status,eligibility}.ts ✔ + tests, issue.ts, render.ts, document.ts,
admin.ts, index.ts, *.test.ts}`, `src/server/ports/pdf.ts` (+ `pdf.contract.ts`, run by fake now and by 100c's adapter),
`src/test/fakes/pdf.ts` (+ test), `src/server/db/schema/certificates.ts`, `src/server/seed/certificates.ts`,
`src/app/admin/certificates/{page.tsx,_components/*}`, `messages/en-IN/adminCertificates.json`,
`drizzle/NNNN_100_pre_file_purpose.sql` (custom: `ALTER TYPE file_asset_purpose ADD VALUE 'certificate_pdf'`) +
`drizzle/NNNN_100_certificates.sql`, `tests/e2e/100-certificates-admin.spec.ts`.
Hotspots: **X1** (`deps.ts`, `harness.ts`, `fakes/*`), H13 (creates the module), H21 (`file_asset_purpose`, job registry), H30
(`results.published` consumer registry), H9 (event → template rows), H8 (`can()` table), H1/H6 barrels, H3 `messages.ts`,
H19 admin nav, H5 data inventory (`name_snapshot`, PDFs), `src/server/app.ts` (one line), `drizzle/meta/*` (merge queue).

## Design (risk-flagged: three interfaces compared)
- **A. One planner, insert the difference ← chosen.** `issueCertificates(ctx, { competitionId, releaseId })` loads facts with
  one query function, calls the pure `planCertificates(competition, registrations, finalOutcomes)` (every rule, one table),
  then `missingCertificates(expected, existing)` and inserts only those (savepoint per row for the number retry; `ON CONFLICT
  DO NOTHING` on the partial unique as the race backstop). Leverage: one function covers ACs 1 and 3; locality: eligibility
  across routes and scopes sits in one file, tested as a table without PGlite. Deletion test: removing it scatters the rules
  over the consumer, the loader and the insert.
- **B. Per-source issuers behind `EligibleCertificateSource`** (school round, final round, registrations). Three adapters of an
  interface with one caller: hypothetical seams. Cross-source rules (winner gets winner only, exclusions) leak into the union
  step. Rejected.
- **C. Issue as events happen** (participation at school finalise, awards at publish). Issues before results are public, breaks
  "publishing results issues", needs three consumers. Rejected.
- **Port `PdfRenderer`**: `render(job: { template: "certificate"; version: number; data: CertificateDocument }): Promise<Uint8Array>`.
  Two adapters (fake here, Gotenberg in 100c) make it a real seam. The data, not HTML, crosses it so the fake can assert on
  content and 100c owns the template. Rejected: `renderHtml(html)` (leaks the template into the handler; fake can't check data).
- **Validity apart from rendering**: rows, numbers and `issued` happen in the general worker (M34-3); only `certificate.render`
  goes to worker-media, so verification works on previews without Gotenberg.
- Table `certificate`: id uuidv7, `number` unique, type, status default `issued`, competition_id, registration_id null (null
  only for volunteer_service; CHECK `(registration_id IS NULL) = (competition_id IS NULL)` style, no enum literal),
  participant_profile_id, entry_id null, round_id null, award_position smallint null, award_label null, name_snapshot,
  template_version, render_status default `pending`, render_attempts, pdf_file_id null, issued_at, source_release_id null,
  revoked_at/by/reason null, superseded_by_id null. Unique `(registration_id, type, round_id) NULLS NOT DISTINCT WHERE status <>
  'superseded'` (literal from the same CREATE TYPE: F2-safe) so #101 can reissue. Diff runs against **all** rows (any status).

## Interface needs (code against these; adopt real names at claim)
```ts
// 99a
type ResultsPublished = { type: "results.published"; payload: { competitionId: string; releaseId: string; publishedAt: string } };
publishedRelease(db: AppDb, competitionId: string): Promise<{ id: string; version: number; publishedAt: Date;
  lines: { entryId: string; entryCode: string; participantProfileId: string; outcome: "winner" | "runner_up" | "finalist" |
  "special_mention" | "none"; awardPosition: 1 | 2 | 3 | null }[] } | null>;
// 97: finalRound(db, competitionId): Promise<{ id: string } | null>
// 89b / 91a
listSchoolRoundOutcomes(db: AppDb, i: { competitionId: string }): Promise<{ registrationId: string; roundId: string;
  roundDecided: boolean; outcome: "pending" | "shortlisted" | "not_shortlisted"; position: number | null }[]>;
// 70a: competition { id; code; name; submissionScope: "all_participants" | "shortlist_only" }
// 75b/78/81b: registration { id; competitionId; participantProfileId; route: "individual" | "institution"; status: ... }
//   participant_profile { id; fullName; dateOfBirth; userId | null }; guardian links (for can() in 100c)
// 85b: entry { id; registrationId; status } + "reached submitted" = status in the post-submitted set
// 73: withUniqueCode({ format: { prefix, length }, constraint, random? }, attempt): Promise<T>  // certificateNumberFormat(at) fits
// 61a: emit(tx, clock, event, { availableAt? }); handler registry; h.drain(); delivery retry/backoff
// 63a: storeGeneratedFile(tx, ctx, { purpose: "certificate_pdf"; bytes: Uint8Array; contentType: "application/pdf";
//   filename: string }): Promise<{ fileAssetId: string }>  // system-owned, born clean (no upload, no scan). Add if absent.
// 59a/60: authorize(ctx, "certificates.list" | "certificates.retry_render", { competitionId }); recordAudit(tx, ctx, ...)
// 69/81b: route rows for "certificates.ready" + audience "guardian_of_participant"
```

## Residue
HR-42 (sample signatory, default wording) · HR-46 append (special mention → participation only; YY = IST issue year;
shortlist-only scope: every enrolled student of a decided school round gets participation; all-participants: only students whose
entry reached `submitted`; any school position or final award also counts as taking part; a registration gets only its best
final award) · HR-44 (minors' certificates) · HR-14 (DLT for "certificate ready" SMS; SMS off) · HR-31 data
inventory (`name_snapshot`, PDFs) · HR-10/M4 (worker-preview redeploy for the consumer).

## Test plan
Unit ✔: `domain/number.test.ts`, `domain/status.test.ts` (transition tables), `domain/eligibility.test.ts` (planner + diff).
Seam 1 (`createHarness`, PGlite, fake clock, `h.drain()`, `FakePdfRenderer`, storage + email fakes): `issue.test.ts` (AC 1–3, 9),
`render.test.ts` (AC 5, 6), `admin.test.ts` (AC 7, 8), `seed.test.ts` (AC 10); `pdf.contract.ts` run by the fake.
Seam 2 written, Not run (no Postgres here; previews fail at `db:migrate`).

## Slices (ordered)
1. **Issue on publish**: schema + migrations, consumer, loader, planner wiring, numbers, audit. AC 1, 2, 3, 4 (DB part), 9, 8 (system-only). `issue.test.ts`.
2. **Render via the port**: `ports/pdf.ts`, fake + contract, `document.ts`, `certificate.render` handler, storage, retries/failed. AC 5. `render.test.ts`.
3. **Ready message**: `certificates.ready` once per recipient + routes/templates. AC 6. `render.test.ts` (ready block).
4. **Admin and seed**: `listCertificates`, `retryCertificateRender`, admin page, messages, seed, e2e spec. AC 7, 8, 10, 11. `admin.test.ts`, `seed.test.ts`.
