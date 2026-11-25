// Ledger periods (#109): finance locks a reconciled month so its figures
// never change silently, and a second finance user approves every lock and
// unlock (./approvals.ts runs them). From the lock line back, nothing posts:
// finance's own entries and reversals are refused, and an automatic posting
// (a capture or refund the platform can't refuse) lands in the first open
// month after the lock line as a late adjustment. The rules are pure, in
// ./domain/period-lock.ts; drizzle/*_109_ledger_period_guard.sql refuses a
// posting into a closed month in the database too.
//
// Serialisation: every posting takes ROW EXCLUSIVE on `ledger_period`
// before it reads the lock line, and a lock or unlock takes SHARE ROW
// EXCLUSIVE, which conflicts with it. So a posting either commits before
// the lock (and the lock includes it) or reads the new lock line.

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize, type PolicyContext } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { financeApproval, ledgerPeriod } from "../../db/schema";
import type { Clock } from "../../ports/clock";

import { insertFinanceRequest } from "./approval-requests";
import {
  comparePeriodMonths,
  isPeriodMonth,
  monthsBetween,
  periodMonthOf,
  type PeriodMonth,
} from "./domain/period";
import {
  assertLedgerPeriodTransition,
  checkPeriodLock,
  checkPeriodUnlock,
  lockLine,
  postingPeriodFor,
  type KnownPeriod,
  type PeriodCheck,
} from "./domain/period-lock";

type Executor = { actor: Actor; clock: Clock; actorRole: Role | null };

export async function loadKnownPeriods(db: AppDb): Promise<KnownPeriod[]> {
  return db
    .select({ month: ledgerPeriod.month, status: ledgerPeriod.status })
    .from(ledgerPeriod);
}

export type ResolvedPeriod =
  | { ok: true; periodMonth: PeriodMonth; lateAdjustment: boolean }
  | { ok: false; error: "period_locked" };

/**
 * The month a posting dated `occurredAt` counts in, and its period row
 * (made open if it is new). Call inside the posting's transaction, before
 * inserting it.
 */
export async function resolvePostingPeriod(
  tx: AppDb,
  input: { occurredAt: Date; mode: "automatic" | "manual"; now: Date }
): Promise<ResolvedPeriod> {
  await tx.execute(sql`LOCK TABLE ledger_period IN ROW EXCLUSIVE MODE`);
  const target = postingPeriodFor({
    month: periodMonthOf(input.occurredAt),
    periods: await loadKnownPeriods(tx),
  });
  if (target.lateAdjustment && input.mode === "manual") {
    return { ok: false, error: "period_locked" };
  }
  await tx
    .insert(ledgerPeriod)
    .values({ month: target.periodMonth, createdAt: input.now })
    .onConflictDoNothing({ target: ledgerPeriod.month });
  return {
    ok: true,
    periodMonth: target.periodMonth,
    lateAdjustment: target.lateAdjustment,
  };
}

/** Whether a manual entry dated `occurredAt` would be refused as closed. */
export async function isClosedForEntries(tx: AppDb, occurredAt: Date) {
  return postingPeriodFor({
    month: periodMonthOf(occurredAt),
    periods: await loadKnownPeriods(tx),
  }).lateAdjustment;
}

type Refusal = Extract<PeriodCheck, { ok: false }>;

function refusal(check: Refusal) {
  return "month" in check
    ? ({ ok: false, error: check.reason, month: check.month } as const)
    : ({ ok: false, error: check.reason } as const);
}

async function lockForChange(tx: AppDb) {
  await tx.execute(sql`LOCK TABLE ledger_period IN SHARE ROW EXCLUSIVE MODE`);
  return loadKnownPeriods(tx);
}

/** Locks `month`, run by the approver of a `period_lock` request. */
export async function executePeriodLock(
  tx: AppDb,
  ctx: Executor,
  { month, requestId }: { month: PeriodMonth; requestId: string }
) {
  const periods = await lockForChange(tx);
  const check = checkPeriodLock({ month, periods, now: ctx.clock.now() });
  if (!check.ok) return refusal(check);
  const before = periods.find((period) => period.month === month)?.status;
  // A month with no row yet goes none -> open -> locked in one step.
  if (before === undefined) assertLedgerPeriodTransition(null, "open");
  assertLedgerPeriodTransition(before ?? "open", "locked");
  if (ctx.actor.kind !== "user") throw new Error("A lock needs an approver");
  const now = ctx.clock.now();
  const locked = {
    status: "locked" as const,
    lockedAt: now,
    lockedByUserId: ctx.actor.userId,
  };
  await tx
    .insert(ledgerPeriod)
    .values({ month, createdAt: now, ...locked })
    .onConflictDoUpdate({ target: ledgerPeriod.month, set: locked });
  await recordAudit(tx, ctx, {
    action: "ledger.period_locked",
    entity: { type: "ledger_period", id: month },
    before: { status: before ?? null },
    after: { status: "locked", requestId },
    actorRole: ctx.actorRole,
  });
  return { ok: true } as const;
}

/** Reopens `month`, run by the approver of a `period_unlock` request. */
export async function executePeriodUnlock(
  tx: AppDb,
  ctx: Executor,
  {
    month,
    reason,
    requestId,
  }: { month: PeriodMonth; reason: string; requestId: string }
) {
  const periods = await lockForChange(tx);
  const check = checkPeriodUnlock({ month, periods });
  if (!check.ok) return refusal(check);
  assertLedgerPeriodTransition("locked", "open");
  if (ctx.actor.kind !== "user") throw new Error("An unlock needs an approver");
  await tx
    .update(ledgerPeriod)
    .set({
      status: "open",
      lockedAt: null,
      lockedByUserId: null,
      lastUnlockedAt: ctx.clock.now(),
      lastUnlockedByUserId: ctx.actor.userId,
      lastUnlockReason: reason,
    })
    .where(eq(ledgerPeriod.month, month));
  await recordAudit(tx, ctx, {
    action: "ledger.period_unlocked",
    entity: { type: "ledger_period", id: month },
    before: { status: "locked" },
    after: { status: "open", requestId },
    actorRole: ctx.actorRole,
  });
  return { ok: true } as const;
}

const monthInput = z.object({
  month: z.string().refine(isPeriodMonth),
});
const unlockInput = monthInput.extend({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !value.includes("\u0000")),
});

/** Whether a pending, unexpired request for `operation` on `month` exists. */
async function hasPendingRequest(
  tx: AppDb,
  operation: "period_lock" | "period_unlock",
  month: PeriodMonth,
  now: Date
) {
  const [row] = await tx
    .select({ id: financeApproval.id })
    .from(financeApproval)
    .where(
      and(
        eq(financeApproval.status, "pending"),
        eq(financeApproval.operation, operation),
        sql`${financeApproval.payload} ->> 'month' = ${month}`,
        gt(financeApproval.expiresAt, now)
      )
    )
    .limit(1);
  return row !== undefined;
}

/** Finance asks to lock a month; a second finance user approves it. */
export async function requestPeriodLock(
  ctx: PolicyContext,
  input: { month: string }
) {
  const { role } = await authorize(ctx, "ledger.period_request");
  const parsed = monthInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" } as const;
  const { month } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock.now();
    const check = checkPeriodLock({
      month,
      periods: await loadKnownPeriods(tx),
      now,
    });
    if (!check.ok) return refusal(check);
    if (await hasPendingRequest(tx, "period_lock", month, now))
      return { ok: false, error: "request_pending" } as const;
    const requestId = await insertFinanceRequest(tx, ctx, role, {
      operation: "period_lock",
      payload: { month },
      audit: { month },
    });
    return { ok: true, requestId } as const;
  });
}

/** Finance asks to reopen the latest locked month, with a reason. */
export async function requestPeriodUnlock(
  ctx: PolicyContext,
  input: { month: string; reason: string }
) {
  const { role } = await authorize(ctx, "ledger.period_request");
  const parsed = unlockInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" } as const;
  const { month, reason } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const check = checkPeriodUnlock({
      month,
      periods: await loadKnownPeriods(tx),
    });
    if (!check.ok) return refusal(check);
    if (await hasPendingRequest(tx, "period_unlock", month, ctx.clock.now()))
      return { ok: false, error: "request_pending" } as const;
    const requestId = await insertFinanceRequest(tx, ctx, role, {
      operation: "period_unlock",
      payload: { month, reason },
      audit: { month },
    });
    return { ok: true, requestId } as const;
  });
}

/**
 * Every month from the ledger's first to the current one, newest first,
 * with its status, its pending request and what finance may ask for next.
 */
export async function listLedgerPeriods(ctx: PolicyContext) {
  await authorize(ctx, "ledger.read");
  return ctx.db.transaction(
    async (tx) => {
      const now = ctx.clock.now();
      const currentMonth = periodMonthOf(now);
      const rows = await tx
        .select()
        .from(ledgerPeriod)
        .orderBy(asc(ledgerPeriod.month));
      const pending = await tx
        .select({
          id: financeApproval.id,
          operation: financeApproval.operation,
          month: sql<string>`${financeApproval.payload} ->> 'month'`,
        })
        .from(financeApproval)
        .where(
          and(
            eq(financeApproval.status, "pending"),
            sql`${financeApproval.operation} IN ('period_lock', 'period_unlock')`,
            gt(financeApproval.expiresAt, now)
          )
        )
        .orderBy(asc(financeApproval.id));
      const periods: KnownPeriod[] = rows;
      const line = lockLine(periods);
      // A late adjustment can open the month after the current one.
      const latest = rows.at(-1)?.month;
      const last =
        latest && comparePeriodMonths(latest, currentMonth) > 0
          ? latest
          : currentMonth;
      const first = rows[0]?.month;
      const months = monthsBetween(
        first && comparePeriodMonths(first, last) < 0 ? first : last,
        last
      );
      const byMonth = new Map(rows.map((row) => [row.month, row]));
      return {
        currentMonth,
        lockLine: line,
        periods: months.reverse().map((month) => {
          const row = byMonth.get(month);
          const request = pending.find((item) => item.month === month);
          const closed = line !== null && comparePeriodMonths(month, line) <= 0;
          return {
            month,
            status: row?.status ?? (closed ? "locked" : "open"),
            hasRow: row !== undefined,
            lockedAt: row?.lockedAt ?? null,
            lastUnlockedAt: row?.lastUnlockedAt ?? null,
            lastUnlockReason: row?.lastUnlockReason ?? null,
            pendingRequest: request
              ? { requestId: request.id, operation: request.operation }
              : null,
            canRequestLock:
              !request && checkPeriodLock({ month, periods, now }).ok,
            canRequestUnlock:
              !request && checkPeriodUnlock({ month, periods }).ok,
          };
        }),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
