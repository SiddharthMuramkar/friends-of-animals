# 105: Ledger with automatic postings (#105, M5, L, risk)

Branch `ticket/105-ledger-with-automatic-postings`, worktree `/root/foa-wt/105`, base `foa/M0` 442dd99. Blocker 80a, and through it 79, 77a, 61a, 60, 59a and 57a/b. No siblings. Owns hotspot H34.
**Head start:** 6739cf5 `M5 #105: Add ledger domain core`. It's pure, with 109 tests, and touches no shared file: `src/server/modules/ledger/domain/{posting,posting-rules,chart,period,money,trial-balance}.ts`. Rebase it onto `M5` when that branch exists.
Prepped by foa-p105 on 2026-11-21 against `foa/ticket/57-harness` 0569f4f (PR #140, may still change).

## Scope
- **In:** the Ledger module (`src/server/modules/ledger/**`). Schema `ledger.ts`: `ledger_account`, `ledger_posting`, `ledger_line` and enum `ledger_account_kind`. A custom SQL migration with the append-only triggers, the deferred balance triggers and the seeded chart. One posting entry point, `postToLedger`. Outbox consumers for online captures, offline payments and processed refunds. The backfill and a daily reconcile schedule. Manual entries and reversing a manual entry. Category management. Read queries for the screens. Four admin pages, namespace `adminLedger`, the preview seed, and the Seam 2 spec (written, not run).
- **Out:** periods, lock and late adjustments (109a adds `ledger_period`, `late_adjustment` and `original_period_month` in its own migration). Budgets and export (109b). Donation accounts 42xx/2100 and their rules (106a, 107, 108). Transparency (#110). Settlement and gateway fees (HR-47 follow-up). Payments in #79 `needs_review` aren't posted, because they captured no batch; a follow-up adds suspense liability `2200` once #79's resolutions exist. #105 makes **no edits** to Payments (H14): it only reads.

## Acceptance checks (S1 = `h.as(actor).<useCase>` on PGlite + real migrations, FakeClock, gateway and refund fakes, `h.drain()`)
1. A captured online payment, once drained, gives exactly one posting (`payment_capture` / gateway payment id) with lines Dr 1100 / Cr 4100 for the batch amount. Debits equal credits, by `trialBalance` and by a raw `SUM`. S1.
2. An offline payment (#79) gives one posting (`offline_payment` / offline payment id): Dr 1000 for a bank transfer or cheque, or Dr 1010 for cash, and Cr 4100. S1.
3. A processed refund (#80, partial allowed) gives one posting (`refund` / refund id) with `reversal_of_posting_id` set to the capture posting and lines that mirror it for the refund amount. The capture's header and lines are deep-equal before and after. S1.
4. Replays change nothing. Re-emit the capture or refund event (new outbox rows, same source) and drain again: the posting, line and audit counts don't move. A refund drained before its capture posting exists posts the capture first, so order doesn't matter. S1.
5. Backfill: captures made with nothing drained, then `backfillLedgerFromPayments` as `system` gives N postings. Running it again still gives N, and so does draining the pending events afterwards. S1.
6. SQL guards, tested with raw SQL on `h.db`: UPDATE, DELETE and TRUNCATE on posting or line raise. An unbalanced insert (Dr 100 / Cr 90), a single line, or a header with no lines raises at COMMIT. A line with both or neither side set, or a currency other than INR, fails its CHECK. S1.
7. `createManualEntry({date, description, lines})` (finance; at least 2 balanced lines) writes a `manual` posting whose `period_month` is the IST month of the date. These are refused with a code and leave no rows: unbalanced, too few or too many lines, a zero amount, an unknown or inactive account, a future date, an empty description. S1.
8. Categories. `createLedgerAccount` takes income or expense only, with the code in the kind's range; a code in use gets `code_taken`. `updateLedgerAccount` renames and sets the public label and group. `deactivateLedgerAccount` stops new manual lines on the account and keeps its history. System accounts get `system_account`. S1.
9. Every ledger write adds one audit row: `ledger.posting_created` (automatic and manual), `ledger.posting_reversed`, `ledger.account_created`, `ledger.account_updated`, `ledger.account_deactivated`. The after-image holds ids, codes, totals and line count, never a description or memo. Replays and refusals write no row. S1.
10. `listPostings({accountCode?, from?, to?, cursor?})` filters by category (any line on that account) and by whole IST days, newest first, in keyset pages by `seq`, with debit and credit totals. `getPosting(seq)` returns the lines. S1.
11. IST period: a capture at 2026-04-30T19:00Z lands in `2026-05` and appears under the filter `from=to=2026-05-01`. S1, plus the pure test (done).
12. Authorization for each use case. Finance passes. `competition_manager`, `staff_admin`, `super_admin` without a finance grant, and a member are refused `forbidden`. Finance without this session's staff second factor is refused (#60). Consumers and the backfill refuse a user actor and allow `system`. S1.
13. `reversePosting(seq)` on a manual posting writes the mirror posting (`reversal` / original id). Reversing it again gets `already_reversed`; reversing an automatic posting gets `not_reversible`. S1.
14. Running `seed.preview()` twice gives identical rows: seeded paid batches backfilled, 2 manual entries, 1 custom category and a finance user. The DB chart equals `SEEDED_ACCOUNTS`. S1.
15. `/admin/ledger`, `/admin/ledger/[seq]`, `/admin/ledger/entries/new` and `/admin/ledger/accounts` render for the seeded finance user, and axe is clean in both themes. Seam 2 spec `tests/e2e/105-ledger.spec.ts`, **Not run**.
16. `DATABASE_URL= DIRECT_URL= APP_ENV=local pnpm build && pnpm check:build` passes. The admin pages are dynamic and no public page changes. Gate.

## Files
- **New:** `src/server/db/schema/ledger.ts`; `drizzle/NNNN_105_ledger.sql` (generated) and `NNNN_105_ledger_guards.sql` (`--custom`: triggers plus the chart insert). Module `src/server/modules/ledger/`: `domain/*` (done), `post.ts`, `sources/payments.ts`, `consumers.ts`, `backfill.ts`, `manual-entry.ts`, `reverse.ts`, `accounts.ts`, `queries.ts`, `policy.ts`, `index.ts` (`ledgerUseCases`). Also `src/server/seed/ledger.ts`, `src/app/admin/ledger/**` (with `_components/` and `_lib/`), `messages/en-IN/adminLedger.json`, `tests/e2e/105-ledger.spec.ts`.
- **Hotspots** (one line or entry each): the `schema/index.ts` and `seed/index.ts` barrels; `src/server/app.ts` (one module); #59's `POLICY` spread (H8); #61a's handler registry (H9); `SCHEDULES` (H10, 61b); the admin nav (H19, 59b); `src/i18n/messages.ts` (H3); #73's data inventory (H5: description and memo, `toConfirm`); `drizzle/meta/*` (regenerated). 106a, 107, 108, 109a/b and #133 extend H34 after this, so merges serialize.

## Design (codebase-design; three compared)
- **A. Simplest thing:** one consumer per event builds its lines inline and checks the balance in TypeScript. It's shallow: each consumer repeats the idempotency, period, audit and code lookup, and nothing stops a bad posting at the database. Rejected.
- **B. One deep entry point (chosen):** `postToLedger(tx, ctx, entry)`. Behind it: `checkLines`, code→id resolution (active accounts only), the IST period, `INSERT … ON CONFLICT (source_type, source_id) DO NOTHING RETURNING`, the lines, and the audit row. Consumers become about 10-line adapters: payment facts, then a pure rule (`posting-rules.ts`), then `postToLedger`. A new money source adds one rule and one source type, and 109a wraps the one entry point for the lock.
- **C. SQL-first invariants:** adopted *under* B as defence in depth. Append-only `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers. `DEFERRABLE INITIALLY DEFERRED` constraint triggers on line and header that check at least 2 lines and balance per posting at commit. A unique source key, and CHECKs for one side and INR. **Verified on PGlite 18.6 today:** the unbalanced, single-line and mutation cases all raise; a lone header commits, hence the header trigger too. Property tests are skipped: they need a new dependency, so table tests cover them.
- **Rejected:** signed single-entry rows (F3 forbids). Idempotency by outbox event id: a re-emitted event gets a new id and the backfill has none, so the key is the source.
- **Backfill:** (a) a migration-inserted one-shot outbox row is rejected: every test DB clone would carry a pending delivery and change every module's `h.drain()` report. (b) A pg-boss one-shot job is worker-only and can't run under the fake clock. (c) An owner CLI is a manual step in every environment. **(d) chosen:** `backfillLedgerFromPayments` (system) is idempotent by source key. It runs from `seedLedger` on previews and from a daily `ledger.reconcilePayments` schedule (03:00 IST). Its first run after deploy is the backfill; later runs catch dropped or skewed events.
- **Other defaults:**
  - The chart is inserted by the custom migration with fixed literal UUIDs: production needs the system accounts, and the PG16 floor has no `uuidv7()`.
  - The key is `(source_type, source_id)`, with no `posting_kind`.
  - `seq` is `bigint generated always as identity` and serves as the URL journal number.
  - Amounts use `bigint({mode:"bigint"})` as 77a does; pages pass strings to client islands.
  - `occurred_at` is the payment's `captured_at` or the refund's `processed_at`; `created_at` comes from `ctx.clock`.
  - Manual entries: the date is an IST date, not in the future, and `occurred_at` is the start of that IST day. Description 1–500 characters, memo up to 200, line cap `MAX_LINES` = 20.
  - Only manual postings can be reversed; automatic ones are corrected by refunds or a manual entry.
  - Finance only: super admin isn't a wildcard (#59). Every action carries the staff second factor; step-up and two approvers come with 109a.

## Interface needs (code against these; adapt names at rebase)
```ts
// 57a (PR #140): UseCaseContext = Deps & { actor: Actor }; composeUseCases(...); createHarness(); uuidv7(at); AppDb; Seeder
// 59a
authorize(ctx: UseCaseContext, action: LedgerAction, resource?: Resource): Promise<{ role: Role | null }>; // throws forbidden
recordAudit(tx: AppDb, ctx: UseCaseContext, e: { action: string; entity: { type: string; id: string };
  before: unknown; after: unknown; actorRole: Role | null }): Promise<void>;
role("finance"); system("worker", "seed", "cli"); // LEDGER_POLICY spread into POLICY; seed builder grant(user, grant)
// 60: policy rule flag secondFactor: "staff"; seeded staff carry SEED_TOTP_SECRET; a harness way to sign in with a fresh factor
// 61a
emit(tx: AppDb, clock: Clock, event: DomainEvent, options?: { availableAt?: Date }): Promise<void>;
type HandlerEntry = { name: string; event: DomainEvent["type"]; run(deps: Deps, delivery: { eventId: string; payload: unknown }): Promise<void> };
// h.drain(): Promise<DrainReport>.  61b: SCHEDULES entry { name, cron: "0 3 * * *", tz: "Asia/Kolkata", run(deps) }
// 77a: event "payment.batch_captured" { batchId }; payment_batch { id, competitionId, amountMinor: bigint, currency: "INR",
//   status, capturedAt: Date | null, gatewayPaymentId: string | null }   <- needs the capturing payment id stored
// 79: offline_payment { id, batchId, method: "cheque" | "bank_transfer" | "cash", amountMinor: bigint, receivedAt: Date }
//   and an event naming it (payment.batch_captured with offlinePaymentId, or payment.offline_recorded { offlinePaymentId })
// 80a: refund { id, batchId, status, amountMinor: bigint, processedAt: Date | null, method?: MoneyMethod };
//   event "refund.processed" { refundId }
// Ledger-local reader over those tables (src/server/modules/ledger/sources/payments.ts):
type CaptureFact = { sourceType: "payment_capture" | "offline_payment"; sourceId: string; batchId: string;
  competitionId: string; amountMinor: bigint; method: MoneyMethod; occurredAt: Date };
type RefundFact = { refundId: string; batchId: string; amountMinor: bigint; method?: MoneyMethod; occurredAt: Date };
```
**Exports for 106a–110 and #133:** `postToLedger(tx, ctx, { source: { type: LedgerSourceType; id: string }; occurredAt: Date; description: string; lines: readonly LineDraft[]; competitionId?: string; reversalOfPostingId?: string }): Promise<{ outcome: "posted" | "duplicate"; postingId: string; seq: bigint }>`, and `ledgerTrialBalance(db, range?)`.

## Residue
- **HR-47:** the accountant confirms the chart's codes, names and public labels and groups, the method→account map (cheque→bank), the Rs 100 crore line cap, and the follow-ups for settlement fees and suspense.
- **HR-31:** descriptions and memos may name people. Inventory row `toConfirm`, under the 8-year financial floor; append-only means no erasure before the floor.
- **HR-10:** redeploy `worker-preview` and staging for the consumer and the schedule. Previews still work through 61a's drain route and the seed backfill.
- **HR-01/HR-02:** Seam 2 on previews. **Not run here:** Seam 2 and `pnpm db:migrate` on real Postgres.

## Test plan
- Pure (done, 109): `domain/{period,money,posting,posting-rules,chart,trial-balance}.test.ts`.
- Seam 1: one file per slice, below. Raw SQL through `h.db.execute(sql…)` for AC 6. Reads go through the query builder (`rowsOf` differs between drivers).
- Seam 2 (written): the finance user signs in with TOTP, opens the 4 pages (`expectRendersAccessibly`, light and dark), creates a manual entry and finds it under its category filter.

## Slices (ordered; each is one behaviour and one test file)
1. Schema, guards migration, chart insert and `postToLedger` with its audit (AC 6, 9 for postings, 11, chart part of 14): `src/server/modules/ledger/post.test.ts`.
2. Payment consumers, replay and order independence (AC 1–4, 12 for the system actor): `payment-postings.test.ts`.
3. Backfill, the reconcile schedule and `seedLedger` (AC 5, 14): `backfill.test.ts`.
4. Finance writes: manual entry, reversal and categories, with audit and authz (AC 7, 8, 9, 12, 13): `finance-writes.test.ts`.
5. Screen reads, the 4 pages, `adminLedger` and the Seam 2 spec (AC 10, 15, 16): `list-postings.test.ts` and `tests/e2e/105-ledger.spec.ts`.
