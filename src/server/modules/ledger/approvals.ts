// The two-approver rule (#109). Chosen money operations wait as pending
// `finance_approval` requests (./approval-requests.ts) until a second,
// different finance user approves them behind a fresh second factor; the
// operation then runs in the approver's transaction, so it takes effect at
// once or not at all. Each operation registers how to read its payload
// and how to run it; a later money operation adds an entry, not a table.
// The decision rules are pure, in ./domain/approval.ts.

import { aliasedTable, and, desc, eq, lte, ne } from "drizzle-orm";
import { z } from "zod";

import { authorize, type PolicyContext } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  financeApproval,
  user,
  type FinanceApprovalRow,
} from "../../db/schema";
import type { ScheduleDefinition } from "../../outbox/schedules";
import type { Clock } from "../../ports/clock";
import { readSetting } from "../settings/read";

import {
  assertFinanceApprovalTransition,
  decideFinanceApproval,
  FINANCE_OPERATIONS,
  type FinanceDecision,
  type FinanceOperation,
} from "./domain/approval";
import { isPeriodMonth } from "./domain/period";
import { checkLines } from "./domain/posting";
import {
  executeManualEntry,
  manualEntryPayload,
  payloadLines,
} from "./manual-entry";
import { executePeriodLock, executePeriodUnlock } from "./periods";

type Executor = { actor: Actor; clock: Clock; actorRole: Role | null };
type Executed =
  | { ok: true; postingId?: string; seq?: bigint }
  | { ok: false; error: string; month?: string };

type Operation<P> = {
  payload: z.ZodType<P>;
  execute(
    tx: AppDb,
    ctx: Executor,
    payload: P,
    request: FinanceApprovalRow
  ): Promise<Executed>;
};

const monthPayload = z.object({ month: z.string().refine(isPeriodMonth) });

const OPERATIONS: { [K in FinanceOperation]: Operation<never> } = {
  period_lock: operation({
    payload: monthPayload,
    execute: (tx, ctx, { month }, request) =>
      executePeriodLock(tx, ctx, { month, requestId: request.id }),
  }),
  period_unlock: operation({
    payload: monthPayload.extend({ reason: z.string().min(1) }),
    execute: (tx, ctx, { month, reason }, request) =>
      executePeriodUnlock(tx, ctx, { month, reason, requestId: request.id }),
  }),
  manual_entry: operation({
    payload: manualEntryPayload,
    execute: (tx, ctx, payload, request) =>
      executeManualEntry(tx, ctx, payload, request),
  }),
};

function operation<P>(definition: Operation<P>): Operation<never> {
  return definition as unknown as Operation<never>;
}

function isFinanceOperation(value: string): value is FinanceOperation {
  return (FINANCE_OPERATIONS as readonly string[]).includes(value);
}

/** Carries a refusal out of a transaction, so its writes roll back. */
class Refused extends Error {
  constructor(readonly result: { ok: false; error: string; month?: string }) {
    super(result.error);
  }
}

const requestIdInput = z.object({ requestId: z.uuid() });
const rejectInput = requestIdInput.extend({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !value.includes("\u0000")),
});

const AUDIT_ACTION = {
  approved: "ledger.approval_approved",
  rejected: "ledger.approval_rejected",
  cancelled: "ledger.approval_cancelled",
  expired: "ledger.approval_expired",
} as const;

/** Applies `decision` to the locked request row; null when it isn't there. */
async function decide(
  tx: AppDb,
  ctx: PolicyContext,
  requestId: string,
  decision: FinanceDecision,
  role: Role | null,
  run?: (request: FinanceApprovalRow) => Promise<Executed>
) {
  const [request] = await tx
    .select()
    .from(financeApproval)
    .where(eq(financeApproval.id, requestId))
    .for("update");
  if (!request) return { ok: false, error: "not_found" } as const;
  const now = ctx.clock.now();
  const result = decideFinanceApproval({ request, decision, now });
  if (!result.ok) return { ok: false, error: result.reason } as const;
  assertFinanceApprovalTransition(request.status, result.to);
  const to = result.to as keyof typeof AUDIT_ACTION;

  await tx
    .update(financeApproval)
    .set({
      status: to,
      decidedAt: now,
      decidedByUserId: decision.kind === "expire" ? null : decision.byUserId,
      decisionReason: decision.kind === "reject" ? decision.reason : null,
    })
    .where(eq(financeApproval.id, request.id));
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTION[to],
    entity: { type: "finance_approval", id: request.id },
    before: { operation: request.operation, status: request.status },
    after: { operation: request.operation, status: to },
    actorRole: role,
  });
  const executed: Executed = run ? await run(request) : { ok: true };
  if (!executed.ok) throw new Refused(executed);
  if (executed.postingId) {
    await tx
      .update(financeApproval)
      .set({ executedPostingId: executed.postingId })
      .where(eq(financeApproval.id, request.id));
  }
  return {
    ok: true,
    status: to,
    ...(executed.seq === undefined ? {} : { seq: executed.seq }),
  } as const;
}

async function refusedOrThrown<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refused) return error.result;
    throw error;
  }
}

/**
 * A second, different finance user approves a request behind a fresh
 * second factor, and its operation runs now. The operation's own rules are
 * checked again first: a month that can't be locked any more leaves the
 * request pending, with the reason.
 */
export async function approveFinanceRequest(
  ctx: PolicyContext,
  input: { requestId: string }
) {
  const { role } = await authorize(ctx, "ledger.approval_approve");
  const parsed = requestIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" } as const;
  if (ctx.actor.kind !== "user") throw new Error("Approver must be a user");
  const byUserId = ctx.actor.userId;
  return refusedOrThrown(() =>
    ctx.db.transaction((tx) =>
      decide(
        tx,
        ctx,
        parsed.data.requestId,
        { kind: "approve", byUserId },
        role,
        async (request) => {
          if (!isFinanceOperation(request.operation)) {
            throw new Error(`Unknown finance operation ${request.operation}`);
          }
          const definition = OPERATIONS[request.operation];
          const payload = definition.payload.parse(request.payload);
          return definition.execute(
            tx,
            { ...ctx, actorRole: role },
            payload,
            request
          );
        }
      )
    )
  );
}

/** A different finance user turns a request down, with a reason. */
export async function rejectFinanceRequest(
  ctx: PolicyContext,
  input: { requestId: string; reason: string }
) {
  const { role } = await authorize(ctx, "ledger.approval_decide");
  const parsed = rejectInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      error: field === "reason" ? "reason_required" : "not_found",
    } as const;
  }
  if (ctx.actor.kind !== "user") throw new Error("Decider must be a user");
  const { requestId, reason } = parsed.data;
  const byUserId = ctx.actor.userId;
  return ctx.db.transaction((tx) =>
    decide(tx, ctx, requestId, { kind: "reject", byUserId, reason }, role)
  );
}

/** The requester withdraws their own request. */
export async function cancelFinanceRequest(
  ctx: PolicyContext,
  input: { requestId: string }
) {
  const { role } = await authorize(ctx, "ledger.approval_decide");
  const parsed = requestIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" } as const;
  if (ctx.actor.kind !== "user") throw new Error("Decider must be a user");
  const byUserId = ctx.actor.userId;
  return ctx.db.transaction((tx) =>
    decide(tx, ctx, parsed.data.requestId, { kind: "cancel", byUserId }, role)
  );
}

/** Marks every pending request past its window as expired. */
export async function expireFinanceRequests(ctx: PolicyContext) {
  await authorize(ctx, "ledger.approval_expire");
  return ctx.db.transaction(async (tx) => {
    const due = await tx
      .select({ id: financeApproval.id })
      .from(financeApproval)
      .where(
        and(
          eq(financeApproval.status, "pending"),
          lte(financeApproval.expiresAt, ctx.clock.now())
        )
      )
      .orderBy(financeApproval.id);
    let expired = 0;
    for (const { id } of due) {
      const result = await decide(tx, ctx, id, { kind: "expire" }, null);
      if (result.ok) expired += 1;
    }
    return { expired };
  });
}

const EXPIRE_JOB = "ledger.expire_approvals";

export const expireFinanceRequestsSchedule: ScheduleDefinition = {
  name: EXPIRE_JOB,
  cron: "30 3 * * *",
  tz: "Asia/Kolkata",
  async run(deps) {
    await expireFinanceRequests({
      ...deps,
      actor: { kind: "system", process: "worker" },
    });
  },
};

/** What a request asks for, for the approvals screen. */
function summary(request: FinanceApprovalRow) {
  if (request.operation === "manual_entry") {
    const parsed = manualEntryPayload.safeParse(request.payload);
    if (!parsed.success) return { kind: "unknown" } as const;
    const lines = payloadLines(parsed.data);
    const checked = checkLines(lines);
    return {
      kind: "manual_entry",
      date: parsed.data.date,
      description: parsed.data.description,
      lines,
      totalMinor: checked.ok ? checked.totalMinor : null,
    } as const;
  }
  if (
    request.operation === "period_lock" ||
    request.operation === "period_unlock"
  ) {
    const parsed = monthPayload
      .extend({ reason: z.string().optional() })
      .safeParse(request.payload);
    if (!parsed.success) return { kind: "unknown" } as const;
    return {
      kind: request.operation,
      month: parsed.data.month,
      reason: parsed.data.reason ?? null,
    } as const;
  }
  return { kind: "unknown" } as const;
}

/**
 * Pending requests, oldest first, then the latest decided ones: what each
 * asks for, who asked, and what this finance user may do with it.
 */
export async function listFinanceRequests(ctx: PolicyContext) {
  await authorize(ctx, "ledger.read");
  if (ctx.actor.kind !== "user") throw new Error("Reader must be a user");
  const me = ctx.actor.userId;
  const now = ctx.clock.now();
  const requester = aliasedTable(user, "requester");
  const decider = aliasedTable(user, "decider");
  const select = {
    request: financeApproval,
    requesterName: requester.name,
    deciderName: decider.name,
  };
  const base = () =>
    ctx.db
      .select(select)
      .from(financeApproval)
      .leftJoin(requester, eq(requester.id, financeApproval.requestedByUserId))
      .leftJoin(decider, eq(decider.id, financeApproval.decidedByUserId));
  const [pending, decided] = await Promise.all([
    base()
      .where(eq(financeApproval.status, "pending"))
      .orderBy(financeApproval.id),
    base()
      .where(ne(financeApproval.status, "pending"))
      .orderBy(desc(financeApproval.decidedAt), desc(financeApproval.id))
      .limit(30),
  ]);
  const view = ({
    request,
    requesterName,
    deciderName,
  }: (typeof pending)[number]) => {
    const live = request.status === "pending" && now < request.expiresAt;
    const mine = request.requestedByUserId === me;
    return {
      id: request.id,
      operation: request.operation,
      status: request.status,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
      decidedAt: request.decidedAt,
      decisionReason: request.decisionReason,
      requesterName,
      deciderName,
      mine,
      overdue: request.status === "pending" && !live,
      canApprove: live && !mine,
      canReject: live && !mine,
      canCancel: live && mine,
      summary: summary(request),
    };
  };
  return {
    pending: pending.map(view),
    decided: decided.map(view),
    thresholdRupees: await readSetting(
      ctx.db,
      "ledger.manualEntryApprovalThresholdRupees"
    ),
  };
}
