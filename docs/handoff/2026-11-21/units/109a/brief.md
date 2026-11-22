# Brief 109a: period lock, two-approver rule with step-up, locked-period guard, late adjustments

Unit 109a of #109 · M5 · L · risk $ A · branch `ticket/109-lock` · worktree `/root/foa-wt/109a` · blocked by #105 (and
transitively #60 step-up, #62 settings, #59 roles/audit, 61a/61b outbox + schedules). Sibling 109b (budgets, export)
merges after this. Sources: #109 body (no owner comments), #55 decisions (none on #109), `issues-M5.md` §0.3, F8, F16,
§2.1–2.5, §3 #109; spec §1.2, §1.9–1.11; prepped briefs 59a, 60, 62, 61a.

## Scope
**In (109a):** enums `ledger_period_status` (2 values) and `finance_approval_status` (5 values), both with ALL values in
the first migration; tables `ledger_period`, `finance_approval`; custom SQL trigger refusing `ledger_posting` inserts on
or before the lock line; the generic two-approver mechanism (`src/server/modules/ledger/approvals/**`, H44 owner) with
operations `period_lock`, `period_unlock`, `manual_entry`; #105's posting path routing automatic postings for a closed
month to a late adjustment, and refusing manual entries and reversals into a closed month; settings
`ledger.manualEntryApprovalThresholdMinor`, `ledger.approvalExpiryDays`; expiry schedule; audit rows; outbox events;
pages `/admin/ledger/periods`, `/admin/ledger/approvals`; namespaces `adminFinancePeriods`, `adminApprovals`; preview seed
with two finance users. **Pure core already built** (see "Head start").
**Out:** 109b owns `budget`, budget vs actual, the accountant export, `src/server/lib/csv.ts`, `/admin/budgets*`,
`/admin/ledger/export`. #110 owns the transparency read model (reads locked months; it adds `cacheTag('transparency')`).

## Acceptance checks
1. **Request then approve a lock.** Finance A `requestPeriodLock({ month: "2026-11" })` → one `pending` request, period
   still `open`; A `approveFinanceRequest` → `self_approval`; B without fresh step-up → `step_up_required`; B with step-up
   (fake clock inside the window) → request `approved`, period `locked` (`locked_at`, `locked_by` = B), in the same
   transaction. *Seam 1*
2. **Lock rules.** A month that hasn't begun → `period_not_started`; the current month is lockable (F8b); a month on or
   before the lock line → `period_locked`; skipping an earlier open month → `earlier_period_open`. Re-checked at approval
   (a request whose month became unlockable meanwhile is refused with that code and stays pending). *Seam 1 + Vitest (done)*
3. **Locked period rejects postings.** `createManualEntry` and `reversePosting` aimed at a closed month → `period_locked`,
   no rows; raw `INSERT INTO ledger_posting` with a closed `period_month` raises in the trigger; a correction of a November
   posting goes in as a reversal in an open month. *Seam 1*
4. **Late adjustment.** A `payment.captured` dated in a locked November, drained after the lock → posting in the first
   month after the lock line, `late_adjustment = true`, `original_period_month = '2026-11'`; November's lines unchanged
   (select before/after). *Seam 1 (`h.drain()`)*
5. **Unlock.** `requestPeriodUnlock({ month, reason })` needs a non-blank reason (zod); only the latest locked month
   (`later_period_locked`); a different finance user approves with step-up → `open`, `last_unlocked_at`,
   `last_unlock_reason`. *Seam 1*
6. **Manual entry threshold.** Above `ledger.manualEntryApprovalThresholdMinor` (default Rs 50,000, strictly greater) →
   `{ status: "pending_approval", requestId }`, no posting until B approves, then exactly one posting with
   `finance_approval.executed_posting_id` set; at or below → posted immediately. Changing the setting takes effect on the
   next call. *Seam 1*
7. **Reject, cancel, expire.** Reject needs a different finance user and a reason; only the requester cancels; after
   `ledger.approvalExpiryDays` (7) any decision → `request_expired`, and `expireFinanceRequests` (system) marks it
   `expired`. Terminal requests refuse everything (`not_pending`). *Seam 1 + Vitest (done)*
8. **Audit.** Request, approve, reject, cancel, expire, lock and unlock each write one `audit_log` row (actor, role,
   entity `ledger_period`/`finance_approval`, before/after = status and ids only, no personal data, F16). *Seam 1*
9. **Transition tables.** Period: every (none, open, locked) × (open, locked) pair, only none→open, open→locked,
   locked→open allowed. Approval: every pair, only pending→{approved, rejected, cancelled, expired} and none→pending.
   *Vitest (done)*
10. **Authz** on every new use case: finance passes; staff_admin, competition_manager, super_admin without finance, a
    member and a visitor get `forbidden`; `expireFinanceRequests` runs only as system. *Seam 1*
11. **Pages** `/admin/ledger/periods` and `/admin/ledger/approvals` render accessibly, light + dark, no horizontal scroll
    at 320 px. *Seam 2 `tests/e2e/109-period-lock.spec.ts` (written, Not run)*
12. **Seed.** `h.seed.preview()` twice → two finance users (preview-only TOTP, #60 pattern), earlier months locked, one
    pending lock request for the current month. *Seam 1*

## Files and hotspots
- Head start (committed): `src/server/modules/ledger/periods/domain/{period-month,period-status}.ts`,
  `src/server/modules/ledger/approvals/domain/approval.ts` + tests.
- New: `src/server/db/schema/ledger-periods.ts` (+1 barrel line, H1); migrations `--name 109_ledger_periods` (generated)
  then `--custom 109_ledger_period_guard` (trigger) (H2); `src/server/modules/ledger/periods/{index,request-lock,
  request-unlock,list-periods,execute}.ts`; `src/server/modules/ledger/approvals/{index,registry,approve,reject,cancel,
  expire,list}.ts` + `operations/{period-lock,period-unlock,manual-entry}.ts`; `src/server/seed/ledger-periods.ts`
  (+ seeder line after #105's, H6); `messages/en-IN/{adminFinancePeriods,adminApprovals}.json` (+ `messages.ts`, H3);
  `src/app/admin/ledger/{periods,approvals}/{page.tsx,_components/*,actions.ts}`; `tests/e2e/109-period-lock.spec.ts`.
- Edits: #105's `post()` / manual entry / reverse (H34: one period-resolver call each); `composeUseCases` (app.ts); `can()`
  policy table (H8: `ledgerPeriod.*`, `financeApproval.*`, approve flagged `secondFactor: "step-up"`); settings catalogue
  + a money input kind in #62's `definition.ts` (H7); outbox events (H9); schedule `ledger.expireApprovals` daily (H10);
  admin nav + `app-routes.ts` (H19). If #105 already ships an IST month helper, keep #105's and delete
  `period-month.ts` (re-point imports). If #105 used `src/server/ledger/` instead of `modules/ledger/`, move the head
  start next to it.

## Design (risk-flagged: three designs compared)
- **A. Generic approval aggregate + operation registry (chosen).** One `finance_approval` table (operation text, payload
  jsonb of ids/amounts only, status, requested_by/at, decided_by/at, decision_reason, executed_posting_id; CHECK
  `decided_by <> requested_by`). Each operation registers `{ payloadSchema, precheck(tx, payload), execute(tx, ctx,
  payload) }`. `requestPeriodLock` etc. validate + precheck, then insert `pending`. `approveFinanceRequest({ requestId })`
  = authorize (finance + step-up) → `SELECT … FOR UPDATE` → `decideFinanceApproval` (core) → precheck again → execute in
  the same transaction → audit + outbox. Deep: one interface for every two-approver rule, separation of duties, expiry
  and audit in one tested place; #80 discretionary refunds and #133 add an operation file, no new table (leverage).
- **B. Per-operation pending state** (`ledger_period.pending_*` columns, `pending_manual_entry` table). Fewer moving
  parts for two operations, but three copies of self-approval, expiry and audit logic, three authz matrices, and every
  later money operation repeats it. Rejected.
- **C. Draft postings** (manual entry inserted as a draft in `ledger_posting`, flipped on approval). Breaks #105's
  append-only, balanced-at-commit journal and leaks drafts into the export and #110. Rejected.
- **Execute in the approver's transaction, not a job:** the lock takes effect at once, the Server Action calls
  `updateTag('transparency')` after a lock/unlock approval (F8c; `updateTag` is Server-Action-only, docs
  `04-functions/updateTag.md`), and no worker skew on previews (F17).
- **Lock line (in the core):** locked months form a prefix; months lock in order, unlock in reverse; a month on or
  before the latest locked month is closed with or without a row. Guards: use case (`isPeriodClosed`,
  `postingPeriodFor`) + trigger `NEW.period_month <= (SELECT max(month) FROM ledger_period WHERE status = 'locked')`
  → raise `period_locked`. Lock/unlock execution starts with `LOCK TABLE ledger_period IN SHARE ROW EXCLUSIVE MODE`;
  #105's posting path upserts its month's row (none→open), so the two serialize (PGlite can't show races, R16).
- Tables: `ledger_period` (month text PK `YYYY-MM` CHECK format, status, locked_at, locked_by_user_id, last_unlocked_at,
  last_unlocked_by_user_id, last_unlock_reason, created_at). Settings: threshold stored as integer paise (number),
  `BigInt()` at the use case.

## Interface needs (adopt the real names on `M5` at claim)
```ts
// #105 ledger (H34)
ledgerPosting: { id; seq: bigint; occurredAt: Date; periodMonth: string; sourceType: string; sourceId: string;
  postingKind: string; description: string; reversalOfPostingId: string | null; lateAdjustment: boolean;
  originalPeriodMonth: string | null; createdByUserId: string | null }
post(tx: AppDb, ctx: UseCaseContext, p: { occurredAt: Date; sourceType: string; sourceId: string; postingKind: string;
  description: string; reversalOfPostingId?: string | null; lines: { accountId: string; debitMinor: bigint;
  creditMinor: bigint; memo?: string }[] }): Promise<{ postingId: string; seq: bigint; created: boolean }>;
// 109a inserts: resolvePostingPeriod(tx, { occurredAt, mode: "automatic" | "manual" }) → PostingPeriod | refuse
manualEntryInput: z.ZodType<{ occurredAt: Date; description: string; lines: { accountId: string; debitMinor: bigint;
  creditMinor: bigint }[] }>;  postManualEntry(tx, ctx, input): Promise<{ postingId: string }>;
reversePosting(ctx, { postingId: string; reason: string }): Promise<{ postingId: string }>;
// #59
authorize(ctx, action: Action, resource?: Resource): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
recordAudit(tx, ctx, { action: string; entity: { type: string; id: string }; before: unknown; after: unknown;
  actorRole: Role | null }): Promise<void>;
// #60: policy rule flag secondFactor: "step-up"; harness h.signIn(user), h.stepUp(actor)
// #62
readSetting<K extends SettingKey>(db: AppDb, key: K): Promise<SettingValue<K>>;
// 61a / 61b
emit(tx: AppDb, clock: Clock, event: OutboxEvent): Promise<void>;  SCHEDULES (61b registry);  h.drain()
// #69 (if on M5): in-app template for finance_approval.requested / .decided; else events only + residue
```

## Head start (pure core, Vitest only): `b7177b4` on `ticket/109-lock`, 96 tests, `pnpm check` green
- `period-month.ts`: `isPeriodMonth`, `periodMonthOf` (IST), `periodStart`, `next/previousPeriodMonth`,
  `comparePeriodMonths`, `hasPeriodStarted`.
- `period-status.ts`: `LEDGER_PERIOD_STATUSES`, `LEDGER_PERIOD_TRANSITIONS`, `assertLedgerPeriodTransition`, `lockLine`,
  `isPeriodClosed`, `checkPeriodLock`, `checkPeriodUnlock`, `postingPeriodFor`.
- `approval.ts`: `FINANCE_APPROVAL_STATUSES`, transitions, `FINANCE_OPERATIONS`, defaults (5,000,000 paise, 7 days),
  `manualEntryTotalMinor`, `needsSecondApprover`, `approvalExpiresAt`, `decideFinanceApproval`.

## Residue
- HR-17: two distinct finance users enrolled with 2FA in production (period lock is impossible with one).
- HR-51: threshold Rs 50,000 (strictly above), expiry 7 days, lock order (prefix rule), current-month locking, step-up
  on approve only (not on request or reject), late adjustments land in the first month after the lock line.
- HR-47: accountant confirms the close discipline and late-adjustment treatment.
- HR-10/M5: the expiry schedule runs on previews only after the preview worker is redeployed (Seam 1 calls it directly).

## Test plan
Vitest for the core (done). Seam 1 via `createHarness()`: `as(financeA)…`, `h.stepUp(financeB)`, `h.clock.advance`,
`h.drain()`, raw SQL on `h.db` for the trigger; authz matrix per use case. Seam 2 spec with `expectRendersAccessibly`
(+ `.dark`), listed under "Not run".

## Slices (ordered)
1. Schema, enums, migrations (generated + trigger), registry, `requestPeriodLock` + `approveFinanceRequest` executing a
   lock, audit, authz (AC 1, 2, 8, 9, 10) · `approvals/period-lock.test.ts`.
2. Locked-period guard and late adjustments in #105's posting path, trigger (AC 3, 4) ·
   `periods/locked-period-guard.test.ts`.
3. Unlock, reject, cancel, expiry use case + schedule (AC 5, 7, 8, 10) · `approvals/decisions.test.ts`.
4. Manual-entry threshold wrapper + settings (AC 6, 10) · `approvals/manual-entry-approval.test.ts`.
5. Pages, actions (`updateTag`), namespaces, nav, seed, e2e spec (AC 11, 12) · `seed/ledger-periods.test.ts` +
   `tests/e2e/109-period-lock.spec.ts`.
