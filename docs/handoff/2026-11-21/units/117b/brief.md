# 117b: Per-competition reports and CSV export (#117, M5, L, risk: authz + PD)

Branch `ticket/117-reports` · worktree `/root/foa-wt/117b` · cut from `foa/M0` 442dd99 by pane foa-p117 (rebase onto `foa/M5` at build) · blockers 100a, 105 (and through the chain 59a, 60, 70a, 75b, 77a, 78, 79, 80a, 85b, 89a, 92) · no conflict key · H45 shared with 109b. **Head start on the branch:** `fa5e2df M5 #117: Add competition report domain core`, the pure report core `src/server/modules/reports/domain/competition-report.ts` + test (24 cases; see the last section).

## Scope
- **In (117b):** use cases `listReportCompetitions()`, `getCompetitionReport({ competitionCode })` and `exportCompetitionReportCsv({ competitionCode })`. Metrics: registrations, entries, shortlisted, verified and certificates, split by route × age group with route, age-group and grand totals. Fee totals (captured, refunded, net) by route and overall. A CSV of the same table. Audit `reports.exported`. Pages `/admin/reports` and `/admin/reports/competitions/[code]`; route handler `GET /admin/reports/competitions/[code]/export.csv`. Namespace `adminReports`. `can()` actions. Preview-seed check. Seam 2 spec plus axe.
- **Out, 117a (sibling):** the admin home, queues, `/admin`, `adminHome`.
- **Out, later:** objective reports and social metrics (#135); funnel and time series; persisting a different age-group key (F24 isn't needed: 75b stores `registration.age_group_id`).

## Decisions (reversible, recorded; G5 / HR-51)
- **Metric definitions** (all counted per registration's `route` and `age_group_id`, competition = report's):
  - registrations = registrations with status `confirmed` (paid or free). Pending, cancelled, withdrawn and refunded ones aren't counted.
  - entries = entries with a live file (status ∉ `processing`, `rejected`, `failed`).
  - shortlisted = entries with a `school_round_pick` row (89a). This is **school route only**: individual cells are `null`, rendered "—" with a footnote and exported as an empty cell.
  - verified = entries with status `foa_verified`.
  - certificates = `certificate` rows with status `issued` and this competition (participation and award alike; revoked and superseded ones aren't counted).
- **Fee totals** come from payments: captured = Σ `payment_batch.amount_minor` of captured batches (gateway and offline, by batch route); refunded = Σ `refund.amount_minor` with status `refunded` for those batches; net = captured − refunded. They're bigint paise in INR. A Seam 1 cross-check asserts net equals 105's ledger fee-income lines tagged with this `competition_id` (adapt to 105's posting kinds at build).
- **Who reads:** super_admin, staff_admin and finance (global); competition_manager (global, or scoped to that competition). Fee totals are shown to every reader. Everyone else is refused.
- **Export:** the same roles, with the staff second factor and **no step-up**. The CSV is aggregate-only (the numbers on screen), and #55's step-up list targets personal-data exports (US 20, #115). Flipping it is one `secondFactor: "step-up"` flag (HR-51).
- **No personal data in the CSV, by construction:** the table holds labels, counts and amounts only. The competition name and code are the only free text, and csv.ts neutralises formula prefixes.
- Every route × every age group is zero-filled. A "No age group" bucket appears only when some count sits there. An age-group id outside the competition's axis is a bug and throws.

## Acceptance checks (Seam 1 unless marked: `h.as(actor).<useCase>`, PGlite + real migrations, FakeClock, fakes)
1. **Numbers match a hand-computed fixture** (ticket AC 3). Competition A with 3 age groups. 30 confirmed registrations (20 institution: 8/7/5 across the age groups; 10 individual: 4/3/3) + 2 pending + 1 cancelled + 1 refunded (not counted). 24 entries + 2 `processing` + 1 `failed` (not counted). 9 shortlisted. 7 verified. 5 certificates issued + 1 revoked. Every cell, route total, age-group total and the grand total equals the fixture table in the test. Competition B's rows never leak into A.
2. **Fee totals.** Batches: institution Rs 6,000 captured (2 batches), individual Rs 2,500 captured (10 × Rs 250), Rs 250 refunded on 1 individual, plus 1 unpaid batch and 1 refund still `requested` (not counted). Captured, refunded and net match by route and in total, as bigint paise. They also match 105's ledger lines for A.
3. **Pure core** (unit, **done on the branch**): zero-fill, ordering by age-group `position`, totals, `null` shortlisted for individual, summing duplicate rows, a "No age group" bucket, and rejecting unknown age groups, negative or fractional counts and mixed currencies. The table rows used by the page and the CSV are tested too.
4. **Scope** (ticket AC 2 / risk A). A competition_manager scoped to A passes for A and gets `forbidden` for B. `listReportCompetitions` returns only A for them and every competition for global readers.
5. **Refusals.** member, content_manager, institution_admin and visitor get `forbidden` on all three use cases. An unknown code gets `not_found`. A bad code gets `invalid_input` (zod `^[A-Z]{3,6}\d{2}$`).
6. **CSV equals the screen** (ticket AC 4). The CSV parsed back gives the same cells as `getCompetitionReport`. It starts with a UTF-8 BOM, uses CRLF, follows RFC 4180 and writes amounts as numeric cells. The fixture's participant names, emails, phones and registration/entry/participant codes don't appear in it (assert each seeded value is absent). A competition named `=HYPERLINK("x")` is neutralised (`'=`).
7. **Audit.** Each export writes one `audit_log` row: `reports.exported`, entity `{type:"competition", id}`, `after: { report: "competition", format: "csv" }`, with no counts and no PD. Viewing writes nothing.
8. **Authorization per use case:** one allowed and at least one refused test for each of the three.
9. **Seed** (S1). After `h.seed.preview()`, at least one seeded competition has a non-zero value in every metric and in fee totals (add `src/server/seed/reports.ts` only for what's missing). Running it twice changes nothing.
10. **Pages** (S2, written, **Not run**). `/admin/reports` lists reportable competitions. `/admin/reports/competitions/[code]` renders the table (`TableScroller`, "—" with a footnote for n/a, amounts via `getFormatter()` `inr`) and a download link. The handler returns `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`, after `await connection()`. `expectRendersAccessibly` on both pages, light and `.dark`; no horizontal scroll at 320 px.

## Files
- **New:** `src/server/modules/reports/domain/competition-report.ts` + test (**done**); `src/server/modules/reports/competition/{queries,get-competition-report,list-report-competitions,export-competition-report-csv,policy,index}.ts` + Seam 1 tests; `src/server/lib/csv.ts` + `csv.test.ts` (H45: **only if 109b hasn't landed it**; otherwise use theirs and add cases); `src/server/seed/reports.ts` (if needed); `src/app/(staff)/admin/reports/page.tsx`, `reports/competitions/[code]/page.tsx` + `_components/report-table.tsx`, `reports/competitions/[code]/export.csv/route.ts`; `messages/en-IN/adminReports.json`; `tests/e2e/117-reports.spec.ts`. No migration (check that `registration (competition_id, route, age_group_id)` and `entry (competition_id, status)` have indexes; add `--name 117_report_indexes` only if not).
- **One line each:** `src/server/app.ts` (`competitionReportUseCases`), 59a's `policies.ts` (`...REPORTS_POLICY`), `seed/index.ts`, `src/i18n/messages.ts`, `src/lib/app-routes.ts`, `/admin` nav link (59b's layout).
- **Hotspots:** H45 (csv.ts: serialize with 109b), H8 (policy), H19 (59b's admin layout nav). 117a shares no file: it lives under `reports/queues/**`.

## Design (codebase-design; three candidates)
- **A. One SQL query per metric that GROUP BYs straight into the page shape.** Shallow: each caller (page, CSV) reshapes the rows, totals get recomputed twice, and n/a cells and zero-fill leak into SQL.
- **B. Grouped counts + a pure report builder (chosen).** `queries.ts` runs five small `GROUP BY route, age_group_id` counts plus the fee sums (indexed and at pilot scale cheap), returning `ReportCountRow[]` and `FeeRow[]`. The pure `buildCompetitionReport({ ageGroups, counts, fees })` owns every rule: axes, zero-fill, n/a, totals, validation. `reportTable(report, labels)` turns it into typed rows (`text | count | amount | empty` cells) that both the page and csv.ts consume. This is a deep module: small interface, all the hand-computable logic in one place tested without a DB, and the CSV equals the screen by construction.
- **C. A reporting view or materialised view in Postgres.** Needs migrations and refresh, and hides the rules in SQL. Rejected at pilot scale (revisit for #135).

## Interface needs (code against these; adapt names, not shapes)
```ts
// 59a/60: authorize(ctx, action, { scopes: [{ type: "competition", id }] }); recordAudit(tx, ctx, { action: "reports.exported", entity: { type: "competition", id }, before: null, after, actorRole });
//         loadGrants(db, userId) (for listReportCompetitions' scoped ids); rule flag secondFactor: "staff"
// 70a: competition { id, code, name }; competitionAgeGroup { id, competitionId, label, position }
// 75b/78: registration { id, competitionId, route: "institution" | "individual", ageGroupId: string | null, status }; REGISTRATION_STATUSES ∋ "confirmed"
// 85b: entry { id, registrationId, competitionId, status }; ENTRY_STATUSES (processing … foa_verified, sent_back)
// 89a: schoolRoundPick { entryId (PK), roundId }
// 100a: certificate { id, competitionId, registrationId, status }; "issued"
// 77a/79: paymentBatch { id, competitionId, route, status, amountMinor: bigint, currency }; "captured"
// 80a: refund { id, batchId, status, amountMinor: bigint }; "refunded"
// 105: ledgerLine { postingId, accountId, competitionId, debitMinor, creditMinor } + the fee-income account code (cross-check only)
// H45 csv.ts: toCsv(rows: readonly (readonly CsvCell[])[]): string   // BOM + CRLF + neutralise; amount cells numeric
type CsvCell = { kind: "text"; value: string } | { kind: "count"; value: number } | { kind: "amount"; minor: bigint } | { kind: "empty" };
```

## Residue
- **G5 / HR-51:** metric definitions (confirmed-only registrations, shortlisted = school picks), who reads reports, fee totals visible to competition managers, export without step-up.
- **HR-17 / HR-66:** "FOA leadership" report readers have no role yet. They map to staff_admin until FOA rules otherwise.
- **HR-47:** whether fee totals should come from the ledger once the accountant fixes the chart of accounts (the cross-check catches drift).

## Test plan
Pure (**done**): `reports/domain/competition-report.test.ts`. Unit: `src/server/lib/csv.test.ts` (if 117b owns H45). Seam 1: `competition/get-competition-report.test.ts` (AC1, 4, 5, 8), `competition/fee-totals.test.ts` (AC2), `competition/export-csv.test.ts` (AC6, 7, 8), `src/server/seed/reports.test.ts` (AC9). Seam 2 + axe: `tests/e2e/117-reports.spec.ts` incl. the CSV download, **Not run**.

## Slices (size L: four, after the done core)
0. **Done:** `buildCompetitionReport`, `reportTable` (pure).
1. Counts report: `queries.ts` (five grouped counts), `getCompetitionReport`, `listReportCompetitions`, policy, scope (AC1, 4, 5, 8) → `competition/get-competition-report.test.ts`.
2. Fee totals from payments net of refunds + ledger cross-check (AC2) → `competition/fee-totals.test.ts`.
3. CSV: csv.ts (if unowned), `exportCompetitionReportCsv`, audit, route handler (AC6, 7) → `competition/export-csv.test.ts`.
4. Pages, namespace, nav link, seed check, Seam 2 spec (AC9, 10) → `src/server/seed/reports.test.ts` + `tests/e2e/117-reports.spec.ts`.

## Head start (pure core, on `ticket/117-reports`)
`buildCompetitionReport(input): CompetitionReport` and `reportTable(report, labels): { header: CsvCell[]; rows: CsvCell[][] }` in `src/server/modules/reports/domain/competition-report.ts`. It depends on nothing unbuilt: routes and metrics are local constants, and the build pane swaps the route list for 75b's exported enum values (`REGISTRATION_ROUTES`) at rebase.
