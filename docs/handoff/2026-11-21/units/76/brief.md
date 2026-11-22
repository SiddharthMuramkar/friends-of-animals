# Unit 76: Import students from CSV with a per-row error report (#76, M1, M, risk)

Branch `ticket/76-import-students-from-csv-with`, worktree `/root/foa-wt/76`, base `foa/M0` today (rebase onto `foa/M1`
once 75b merges). Blocker **75b** (and through it 75a, 71, 74, 73, 70a, 69, 59a, 58, 57a). No siblings: this unit is all of #76.
Reuses 75b's `parseStudentDetails`, `ageGroupFor`, `identityKeyInput`, its duplicate rule and its per-student insert.
#77c's Seam 2 journey reuses the clean 30-row fixture. Prepped 2026-11-21 by pane foa-p76; domain core on the branch.

## Scope
- **In:** use cases `importStudents` (write) and `describeStudentImport` (read: columns, limits, competition, window);
  page `/institution/registrations/[ref]/import` (template, column guide, upload, result: counts, problem table,
  "download rows to fix"); route handlers `.../import/template.csv` and, outside production, `.../import/sample.csv`;
  one `registration.students_imported` counts audit row; sample + clean-30 fixtures; dashboard link; Seam 2 spec.
- **Out:** no schema, migration or new PD column (stateless, see Design); no inventory rows. Preview-then-commit,
  stored uploads and import history (prior art's pipeline) → not asked for. Discipline/category columns → #85.
  Cross-route duplicates (same child registered individually, prior art E6) → #78's call. Editing students → later.

## Acceptance checks (seam)
1. 30-row clean file (`CLEAN_STUDENT_IMPORT_CSV_30`) into an open registration → `{ ok: true, counts: { total: 30,
   enrolled: 30, notEnrolled: 0, invalid: 0, duplicateInFile: 0, alreadyEnrolled: 0 } }`; 30 profiles + 30 `enrolled`
   registrations under that institution registration, ages grouped as 75b does. (S1)
2. Mixed file → good rows enrolled; `notEnrolled` names each bad row by spreadsheet row number (header = row 1) with
   its cells and problems in 75b's per-field codes (`required`, `invalid_date`, `in_future`, `invalid_phone`,
   `invalid_choice`, …) plus `outside_age_groups` (age + groups) and `extra_cells`; no profile, registration or
   per-student audit row for any bad row. (unit + S1)
3. Duplicates never added twice: same child twice in the file (75b's identity key: "Aanya  Rao" / "aanyá rao" with
   2016-03-09 / 09/03/2016, or the same `student_ref`) → first row enrolled, later rows `duplicate_in_file` with
   `duplicateOf: <first row>`; child already enrolled in this registration → `already_enrolled` (wins over in-file);
   withdrawn students don't count. Active registrations for the child stay at 1. (unit + S1)
4. Re-upload: the generated report with its bad rows fixed enrols exactly those rows; the whole original file again
   enrols 0 and reports every earlier good row `already_enrolled`. (unit + S1)
5. Audit: one `registration.students_imported` row per import that ran (also with 0 enrolled), entity
   `institution_registration`, after = `{ institutionRegistrationId, ...counts }` (no names, no PD), actor + IP + UA;
   each enrolled row also writes 75b's `registration.student_enrolled`. Refused files and refusals write none. (S1)
6. No half rows: each row's profile + registration + audit commit together or not at all; a unique-index conflict on
   one row (lost race) → that row `already_enrolled`, the rest commit; any other error rolls back the whole import
   (no rows, no counts row). (unit `enrolPlannedRows` + S1 invariant: per enrolled row exactly 1/1/1, per bad row 0)
7. Unreadable file → `{ ok: false, reason: "unreadable_file", problem }`, nothing written: `empty`, `too_large`
   (> 750 KiB), `not_utf8` (Excel's Windows-1252 "CSV"), `wrong_separator` (`;`/tab), `malformed` (+ line),
   `missing_columns` (`full_name`, `date_of_birth`), `duplicate_columns`, `no_rows`, `too_many_rows` (> 1,000).
   Unknown columns are ignored and listed; the report's own `row_number`/`problems` columns are ignored silently. (unit + S1)
8. Window: before open / after close (fake clock + #71 drain) → `not_open_yet` / `closed`; unknown ref → `not_found`. (S1)
9. Report CSV: the uploaded header (earlier report columns dropped) + `row_number`, `problems`; rows as uploaded in row
   order; UTF-8 BOM, CRLF; every cell starting `= + - @` tab CR (quotes in front included) gets a `'` (OWASP CSV
   injection), and the upload takes that `'` off again, so `+91…` phones round-trip. (unit + S1 on the cells returned)
10. Authz: both use cases — coordinator and authorised person of X pass; coordinator of Y, member, visitor →
    `forbidden`, nothing written. (S1 table)
11. Template: `describeStudentImport` → 14 columns in template order with need (`always|minor|adult|optional`) and
    limits; `template.csv` = BOM + header row, `text/csv`, `no-store`, `attachment`; it reads back as `no_rows`. (unit + S1)
12. Seed: `SAMPLE_STUDENT_IMPORT_CSV` (≥ 5 good rows over both seeded age groups; one each: missing guardian phone,
    31/02 date, outside age groups, duplicate in file, one of 75b's seeded students) imported into the seeded
    registration after `h.seed.preview()` → exact counts; again → 0 enrolled. `sample.csv` 404s in production. (S1)
13. axe clean, light + dark: import page empty, success, partial (problem table), refused file.
    `tests/e2e/76-import-students.spec.ts`, written, **Not run**. (S2)

## Design (codebase-design, compared inline)
- **A. Stateless import, report in the response (chosen).** `importStudents({ reference, file: Uint8Array })`:
  `can()` → `readStudentCsv` → 75b's context (registration, window, groups, cut-off, institution defaults) → per row
  `prepareStudent` (75b parse + age group + identity hash) → one query for enrolled keys → pure `planStudentImport`
  → one transaction, savepoint per row via `enrolPlannedRows` → counts audit row last in the same transaction.
  Returns counts + not-enrolled rows (cells + problem codes). The Server Action words the problems from messages,
  builds the CSV with `formatStudentImportReport`, and a leaf client island offers it as a Blob download. Deep:
  one entry point hides parsing, dedupe and atomicity; no PD at rest beyond 75b's columns; no schema, so it stays
  out of the Q1 schema queue (75b → 76 → 77a) and adds no inventory or retention rows.
- **B. Persisted `student_import` + `/import/[id]/errors.csv`.** Survives a reload, but stores bad rows' DOBs and
  phones: encryption, inventory, a purge job (#61 registry hotspot) and a Q1 migration. The coordinator still has the
  original file, so the deletion test says the table earns little. Rejected.
- **C. Prior art's preview-then-commit** (private FileAsset, validating job, preview, commit in batches of 100). Needs
  #63 storage + scanner and #61 jobs; L/XL for a step the ticket doesn't ask for. Rejected.
- Atomicity: one outer transaction with a savepoint per row (not per-row transactions) keeps the counts row true to
  what committed; ≤ 1,000 rows × 3 inserts fits the 300 s function limit. Rows insert sequentially (one connection).
- Limits: 1,000 rows; 750 KiB, not prior art's 2 MB, because the file comes through a Server Action capped at 1 MB
  (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md` "Body size limit"); a full 1,000-row file is
  ~200–300 KB. Raising `serverActions.bodySizeLimit` would touch `next.config.ts` (X4): not worth it.
- Defaults (reversible, say so in the PR): comma only; headers case/space/hyphen-insensitive; only `full_name` +
  `date_of_birth` columns required; blank rows skipped but counted in row numbers; adult own-contact columns named
  `student_phone`/`student_email`; in-file key = 75b's normalised `student_ref` or identity key, first row wins.

## Interface needs (code against these; rename to what lands)
```ts
// 75b, registration module: extract from enrol-student.ts if it isn't split this way already
type EnrolmentContext = { institutionRegistration: { id; institutionId; competitionId; reference };
  competition: { id; code; name; ageCutoffDate: string }; ageGroups: AgeGroup[]; today: CalendarDate;
  institutionDefaults: { pinCode: string | null; city: string | null; state: string | null } };
loadEnrolmentContext(ctx: UseCaseContext, reference: string, action: "registration.students.manage" | "registration.students.read"):
  Promise<{ ok: true; context: EnrolmentContext } | { ok: false; reason: "forbidden" | "not_found" | "not_open_yet" | "closed" }>;
type PreparedStudent = { details: StudentDetails; ageGroup: AgeGroup; identityHash: string; studentRef: string | null };
type StudentProblem = { field: StudentField; code: StudentFieldError }
  | { field: "dateOfBirth"; code: "outside_age_groups"; age: number; groups: AgeGroup[] } | { code: "overlapping_age_groups" | "no_age_groups" };
prepareStudent(context: EnrolmentContext, input: StudentInput): { ok: true; student: PreparedStudent } | { ok: false; problems: StudentProblem[] };
findEnrolledKeys(db: AppDb, institutionRegistrationId: string, c: { identityHashes: string[]; studentRefs: string[] }): Promise<Set<string>>; // "id:…" | "ref:…", non-withdrawn only
insertEnrolment(tx: AppDb, ctx: UseCaseContext, context: EnrolmentContext, s: PreparedStudent): Promise<{ registrationId: string }>; // + student_enrolled audit
// #73: isUniqueViolation(error, "<75b's one-active-registration index>"); #59a: can(...), writeAudit(tx, ctx, {...})
// 57b/59: the action's session → Actor helper; 75b seed: h.seed.institutionRegistration(), seeded students' name + DOB
```
`StudentCsvField` (head start) spells 75b's `StudentInput` keys; add `satisfies` checks against 75b's types on rebase.

## Files
- Head start (done, 4c56991): `src/server/modules/registration/domain/{csv, student-csv, student-import-plan}.ts`
  + tests (RFC 4180 read/write, formula guard, decode/limits/header mapping, template, report, plan, row runner).
- New: `src/server/modules/registration/{import-students, describe-student-import}.ts` + `import-students.test.ts`;
  `src/app/institution/registrations/[ref]/import/{page.tsx, actions.ts, _components/*, _lib/*}`,
  `.../import/template.csv/route.ts`, `.../import/sample.csv/route.ts`; `src/server/seed/student-import-samples.ts`;
  `messages/en-IN/studentImport.json`; `tests/e2e/76-import-students.spec.ts`.
- Touch (hotspots, append-only): registration module `index.ts` (2 use cases), `src/i18n/messages.ts` (namespace),
  `src/lib/app-routes.ts` (import route), dashboard `src/app/institution/registrations/[ref]/page.tsx` (one link;
  #76 before #77 on this file). No schema, migration, proxy, layout, header, `next.config.ts` or `package.json`.
- Next traps: page signed-in + dynamic (`await connection()` under `<Suspense>`, `noindex`); route handlers
  `await connection()`, `Cache-Control: no-store`, `can()` via the read use case; action = authenticate → zod
  (ref + `File`) → `file.size` pre-check → one use case. Read `02-guides/{forms,data-security,server-actions}.md`
  and `03-api-reference/03-file-conventions/route.md` first.

## Residue
- HR-05 (appended): the import hashes with 75b's identity key, so it needs the same `PII_HASH_KEY` per environment.
- Nothing new for HR-30/HR-31: no new PD column; bulk entry of the same minors' data 75b already holds.

## Test plan
- Unit (done, 93 tests): CSV parse/format round-trip, line endings, quotes, BOM, Indic text, errors with line
  numbers; formula guard both ways; header matching, unknown and report columns, blank/short/long rows, every file
  refusal, 1,000-row file under the byte limit; report shape and neutralising; plan (first wins, any key, invalid
  rows ignored, already-enrolled wins, re-upload); counts; row runner (sequential, conflict, rollback).
- Seam 1: `import-students.test.ts` — ACs 1–12 through `h.as(coordinator).importStudents`, rows + audit via `h.db`.
- Seam 2: one spec, `expectRendersAccessibly` light + dark over the 4 states; Not run.

## Slices (size M → 1)
1. Import a file: both use cases, action, page, route handlers, fixtures, messages, dashboard link, Seam 2 spec.
   Proof `src/server/modules/registration/import-students.test.ts` (ACs 1–12; 13 by the spec).
