# Brief 109b: budgets, budget versus actual and the accountant export

Unit 109b of #109 · M5 · M · risk $ · branch `ticket/109-budgets` · worktree `/root/foa-wt/109b` · blocked by 109a
(merge order: nav, namespaces, period helpers) and transitively #105 (ledger tables), #59, #60, #62. Sources: #109 body,
`issues-M5.md` F16, F20, §2.2, §2.4 (H45), §3 #109; spec §1.8–1.11; 109a's brief.

## Scope
**In (109b):** table `budget`; use cases `setBudget`, `getBudgetGrid`, `budgetVsActual`, `exportLedger`; the shared CSV
writer `src/server/lib/csv.ts` (H45: first of 109b / 117b to land owns it); route handler
`GET /admin/ledger/export.csv?from=&to=`; pages `/admin/budgets` (grid category × month), `/admin/budgets/report`
(budget vs actual, variance, % used), `/admin/ledger/export` (date range form → the CSV); namespaces `adminBudgets`,
`adminLedgerExport` (never #105's `adminLedger`); preview seed budgets. **Pure core already built** (see "Head start").
**Out:** 109a owns periods, approvals, the locked-period guard and late adjustments (the export just shows
`late_adjustment` and `period`). #110 owns transparency. #117b reuses `csv.ts` for per-competition reports.

## Acceptance checks
1. **Set budgets.** Finance `setBudget({ accountId, periodMonth, amount: "50,000" })` creates, then updates, one row per
   (account, month) (unique key); an asset/liability/equity account → `not_budgetable`; unknown account → `not_found`;
   bad or negative amount → `invalid_amount`; above Rs 1,000 crore → `too_large`; bad month → zod. Each change writes an
   audit row (`budget.set`, before/after amounts and ids only). Budgets may be set for a locked month (planning data,
   not postings). *Seam 1 + Vitest (amount parsing done)*
2. **Budget vs actual.** Budgets for two categories over two months plus postings (via #105's `post()`) →
   `budgetVsActual({ from: "2026-10", to: "2026-11" })` equals a hand-computed fixture: income actual = credits − debits,
   expense actual = debits − credits, by `period_month` (late adjustments count in the month they were posted to);
   variance, % used (one decimal, truncated), favourable flag, income/expense/net totals. Inactive accounts with a budget
   or activity still appear. *Seam 1 + Vitest (report done)*
3. **Export balances.** `exportLedger({ from: "2026-11-01", to: "2026-11-30" })` → parse the CSV: SUM(debit_inr) =
   SUM(credit_inr) = `trialBalance` totals for postings whose `occurred_at` falls in those IST days; totals row matches.
   *Seam 1*
4. **Export safety.** A narration starting with `=` comes out as `'=…`; amounts stay numeric; a range edge at IST
   midnight includes exactly the postings dated on IST days inside the range (18:29:59Z vs 18:30:00Z). *Seam 1 + Vitest
   (done)*
5. **Export audit and step-up.** Each export writes one audit row (`ledger.exported`, the range and line count, no
   content); without fresh step-up → `step_up_required` (#60 lists exports as sensitive). *Seam 1*
6. **Route handler** returns `text/csv; charset=utf-8`, `content-disposition: attachment;
   filename="foa-ledger-<from>-<to>.csv"`, `cache-control: no-store`; a non-finance caller gets no file. *Seam 2 (written,
   Not run)*
7. **Authz** on `setBudget`, `getBudgetGrid`, `budgetVsActual`, `exportLedger`: finance passes; staff_admin,
   competition_manager, super_admin without finance, a member and a visitor get `forbidden`. *Seam 1*
8. **Pages** `/admin/budgets`, `/admin/budgets/report`, `/admin/ledger/export` render accessibly, light + dark, no
   horizontal scroll at 320 px (grid and report in `TableScroller`; over/under shown with icon + word, never colour
   alone). *Seam 2 `tests/e2e/109-budgets.spec.ts` (written, Not run)*
9. **Seed.** `h.seed.preview()` twice → budgets for the current FY's months on a few income and expense categories, so
   the report has variances on a preview. *Seam 1*

## Files and hotspots
- Head start (committed): `src/server/lib/csv.ts`, `src/server/modules/ledger/export/domain/journal.ts`,
  `src/server/modules/ledger/budgets/domain/budget-vs-actual.ts` + tests.
- New: `src/server/db/schema/budgets.ts` (+1 barrel line, H1); migration `--name 109_budgets` (H2);
  `src/server/modules/ledger/budgets/{index,set-budget,get-budget-grid,budget-vs-actual}.ts`,
  `src/server/modules/ledger/export/{index,export-ledger}.ts` + tests; `src/server/seed/budgets.ts` (+ seeder line, H6);
  `messages/en-IN/{adminBudgets,adminLedgerExport}.json` (+ `messages.ts`, H3); `src/app/admin/budgets/{page.tsx,
  report/page.tsx,_components/*,actions.ts}`; `src/app/admin/ledger/export/{page.tsx,_components/*}` and
  `src/app/admin/ledger/export.csv/route.ts`; `tests/e2e/109-budgets.spec.ts`.
- Edits: `composeUseCases` (app.ts); `can()` table (H8: `budget.view`, `budget.set`, `ledger.export` flagged step-up);
  admin nav + `app-routes.ts` (H19). Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
  route.md` before the handler. If 117b landed `csv.ts` first, keep theirs and port these tests onto it (H45).
- Months list: use 109a's `period-month.ts` (`nextPeriodMonth`, `comparePeriodMonths`) after rebasing on 109a; add a
  `monthsBetween(from, to)` there only if 109a didn't. Drop the IST constant duplicated in `journal.ts` if 109a's or
  #105's helper covers days too.

## Design (risk-flagged: designs compared)
- **Budgets — A. one row per (account, month) + pure report over a grouped SUM (chosen).** `budget` (id uuidv7,
  account_id FK, period_month text CHECK format, amount_minor bigint CHECK >= 0, notes, created_by, updated_by,
  created_at, updated_at; UNIQUE (account_id, period_month)). `setBudget` upserts. Actuals: one query `SUM(debit_minor),
  SUM(credit_minor) GROUP BY account_id, period_month` over #105's lines for the range, then `budgetVsActual` (core).
  Deep: the use case is a load + one pure call; the rules live in one tested function.
- **B. Annual budget with monthly phasing.** Matches some NGO practice but needs a phasing rule and a second table;
  HR-51 says monthly granularity by default. Rejected (reversible: annual = sum of months).
- **C. Materialised actuals table updated on each posting.** Drift risk against the append-only journal, a second
  writer on H34. Rejected; the grouped SUM is cheap at FOA's volume.
- **Export — A. synchronous route handler (chosen)** building the CSV in memory from one query, range capped at 366
  days, `no-store`. **B. worker job writing a file to private storage + link:** needs #63 storage and the preview worker
  (HR-10); overkill for an NGO journal. Rejected.
- Range semantics: the export filters on `occurred_at` by IST day (an accountant's "transactions in April"); the
  `period` column shows the month each posting counts in. Budget vs actual uses `period_month`.

## Interface needs (adopt the real names on `M5` at claim)
```ts
// #105
ledgerAccount: { id: string; code: string; name: string; kind: "asset" | "liability" | "income" | "expense" | "equity";
  isActive: boolean }
ledgerPosting: { id; seq: bigint; occurredAt: Date; periodMonth: string; sourceType: string; sourceId: string;
  description: string; reversalOfPostingId: string | null; lateAdjustment: boolean }
ledgerLine: { postingId: string; accountId: string; debitMinor: bigint; creditMinor: bigint }
trialBalance(db: AppDb, range?: { start: Date; endExclusive: Date }): Promise<{ debitMinor: bigint; creditMinor: bigint }>;
// 109a
type PeriodMonth = string; isPeriodMonth(v): v is PeriodMonth; nextPeriodMonth(m); comparePeriodMonths(a, b);
// #59 authorize / recordAudit, #60 step-up flag and h.stepUp(actor), as in 109a's brief
```

## Head start (pure core, Vitest only): `a72e679` on `ticket/109-budgets`, 60 tests, `pnpm check` green
- `csv.ts`: `toCsv(rows, { bom })`, `decimalCell`, `CsvCell`; neutralises `= + - @ \t \r`, quotes `" , \r \n`.
- `journal.ts`: `JOURNAL_COLUMNS` (12), `buildJournalCsv(postings)` → `{ csv, totals, postingCount, lineCount }`,
  `UnbalancedJournalError`, `formatMinorAsDecimal`, `istDate`, `istDayRange`.
- `budget-vs-actual.ts`: `isBudgetableKind`, `actualMinor`, `parseBudgetAmount`, `MAX_BUDGET_MINOR`, `budgetVsActual`.

## Residue
- HR-47: export format (CSV journal vs Tally import), its columns, filtering by transaction date vs period.
- HR-51: monthly budget granularity, Rs 1,000 crore cap, % used truncated to one decimal, budgets allowed on locked
  months.

## Test plan
Vitest for the core (done). Seam 1 via `createHarness()`: seed accounts (#105), post through `post()`, `as(finance)`
use cases, parse the exported CSV in the test, raw SUM queries on `h.db` for the trial balance; authz matrix per use
case. Seam 2 spec with `expectRendersAccessibly` (+ `.dark`) and the CSV download, listed under "Not run".

## Slices (size M: one)
1. Schema + migration, `setBudget` / `getBudgetGrid` / `budgetVsActual` / `exportLedger` with authz, audit and step-up,
   route handler, three pages, namespaces, nav, seed, e2e spec (AC 1–9) · `budgets/set-budget.test.ts`,
   `budgets/budget-vs-actual.test.ts`, `export/export-ledger.test.ts`, `seed/budgets.test.ts`,
   `tests/e2e/109-budgets.spec.ts`.
