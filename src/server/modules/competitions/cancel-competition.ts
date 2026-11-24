// Cancelling a competition (#80).
//
//   cancelCompetition({ competitionId, reason })     → a super admin, step-up
//   getCompetitionCancellation({ competitionId })    → a super admin
//
// One transaction plans and records; the outbox pays. With the competition
// locked, and its open and paid batches, it reads where every registration
// and paid student stands, asks the pure `planCancellation`
// (./domain/cancellation.ts) what to do, and does it: the competition is
// cancelled (final), refunds still waiting for finance are superseded, one
// cancellation refund per paid batch is approved by the system through
// 80a's `startSystemRefund` (each goes out from the outbox, with its
// retries, so this calls no gateway), unpaid and free registrations and
// open batches are cancelled, and every family contact and every
// institution's coordinators are told. A paid registration stays
// confirmed until its refund is back; 80a's funnel then marks it refunded.
// One audit entry names everything it did; each refund writes its own.
//
// Status jobs of a cancelled competition go stale (planStatusJob), and the
// registration window counts it as closed, so nothing moves it again.
// Loads under plain Node: relative imports only.

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  refund,
  refundItem,
  registration,
  type Competition,
  type RefundRow,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { nextPaymentBatchStatus } from "../payments/domain/batch-status";
import { canSupersedeForCancellation } from "../payments/domain/refund-status";
import { characterCount } from "../payments/domain/review-case";
import {
  acceptedReviewOfBatch,
  refundsAgainstCapture,
} from "../payments/refunds/rows";
import {
  lockRefundsForCancellation,
  startSystemRefund,
  supersedeDiscretionaryRefunds,
} from "../payments/refunds/start-system-refund";
import {
  canTransition as canMoveRegistration,
  type RegistrationStatus,
} from "../registration/domain/registration-status";
import {
  planCancellation,
  type CancellationInput,
  type CancellationPlan,
  type PaidItemRefund,
  type RegistrationStanding,
} from "./domain/cancellation";
import { canTransition } from "./domain/status-machine";
import type { CompetitionStatus } from "./domain/vocabulary";
import { competitionResource, isCompetitionId } from "./manage";

/** A cancellation's reason: 1 to 500 characters, as a reader counts them. */
export const CANCEL_REASON_MAX_LENGTH = 500;

export type CancelCompetitionInput = { competitionId: string; reason: string };

export type CancelCompetitionResult =
  | { ok: true; status: "cancelled" }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "already_cancelled"
        | "reason_required"
        | "reason_too_long";
    };

/** What cancelling would do, counted for the super admin to confirm. */
export type CancellationEffects = {
  /** Registrations still taking part: each family contact is told. */
  registrationsTold: number;
  /** Institution registrations: each one's coordinators are told. */
  institutionsTold: number;
  /** Unpaid and free registrations, cancelled at once. */
  registrationsCancelled: number;
  /** Paid batches refunded through the gateway. */
  gatewayRefunds: number;
  /** Batches paid offline, paid back by hand once finance records it. */
  manualRefunds: number;
  /** Previously accepted foreign-currency receipts finance refunds in the dashboard. */
  dashboardRefunds: number;
  dashboardAmounts: { amountMinor: bigint; currency: string }[];
  /** Everything the INR refunds return, in paise. */
  refundMinor: bigint;
};

export type CompetitionCancellation = {
  id: string;
  code: string;
  name: string;
  status: CompetitionStatus;
  cancelledAt: Date | null;
  cancelReason: string | null;
};

export type GetCompetitionCancellationResult =
  | {
      ok: true;
      competition: CompetitionCancellation;
      /** Null once it is cancelled. */
      effects: CancellationEffects | null;
    }
  | { ok: false; error: "not_found" };

export const cancelCompetitionInput = z.strictObject({
  competitionId: z.string(),
  reason: z.string(),
});

/** Where a registration stands for the plan. */
function standingOf(status: RegistrationStatus): RegistrationStanding {
  switch (status) {
    case "enrolled":
    case "pending_payment":
    // A minor's, held for their guardian (#81): nothing was paid yet.
    case "pending_guardian":
      return "unpaid";
    case "confirmed":
    case "withdrawn":
    case "refunded":
    case "cancelled":
      return status;
  }
}

/** Where a paid student stands with the refund that holds them, if any. */
function refundStateOf(
  held:
    | (Pick<RefundRow, "kind" | "status" | "amountMinor"> & {
        refundId: string;
      })
    | undefined
): PaidItemRefund {
  if (!held) return { kind: "none" };
  if (canSupersedeForCancellation(held)) {
    return { kind: "supersede", refundId: held.refundId };
  }
  return {
    kind: held.status === "refunded" ? "refunded" : "held",
    amountMinor: held.amountMinor,
  };
}

type Loaded = {
  row: Competition;
  input: CancellationInput;
  /** The open batches, with their statuses, by id. */
  openBatches: Map<string, (typeof paymentBatch.$inferSelect)["status"]>;
  /** Each registration's status, by id. */
  statuses: Map<string, RegistrationStatus>;
};

/**
 * The competition and everything the plan reads about it. With `lock`,
 * the competition, its open and paid batches, their refunds, and its
 * registrations stay locked in that order. Read holds after the refund
 * locks so a concurrent decision or settlement is visible to the plan.
 */
async function loadForCancellation(
  db: AppDb,
  competitionId: string,
  { lock }: { lock: boolean }
): Promise<Loaded | null> {
  const query = db
    .select()
    .from(competition)
    .where(eq(competition.id, competitionId));
  const [row] = await (lock ? query.for("no key update") : query);
  if (!row) return null;

  const batchQuery = db
    .select({
      id: paymentBatch.id,
      status: paymentBatch.status,
      captureMethod: paymentBatch.captureMethod,
      amountMinor: paymentBatch.amountMinor,
      acceptedReceipt: {
        caseId: paymentReviewCase.id,
        amountMinor: paymentReviewCase.amountMinor,
        currency: paymentReviewCase.currency,
      },
    })
    .from(paymentBatch)
    .leftJoin(paymentReviewCase, acceptedReviewOfBatch)
    .where(
      and(
        eq(paymentBatch.competitionId, competitionId),
        inArray(paymentBatch.status, ["created", "order_created", "captured"])
      )
    )
    .orderBy(asc(paymentBatch.id));
  const batches = await (lock
    ? batchQuery.for("update", { of: paymentBatch })
    : batchQuery);
  const captured = batches.filter((batch) => batch.status === "captured");
  const capturedIds = captured.map((batch) => batch.id);
  if (lock) await lockRefundsForCancellation(db, capturedIds);
  const committed = new Map<string, bigint>();
  for (const prior of await refundsAgainstCapture(db, capturedIds)) {
    if (canSupersedeForCancellation(prior)) continue;
    committed.set(
      prior.batchId,
      (committed.get(prior.batchId) ?? 0n) + prior.amountMinor
    );
  }

  const registrationQuery = db
    .select({ id: registration.id, status: registration.status })
    .from(registration)
    .where(eq(registration.competitionId, competitionId))
    .orderBy(asc(registration.id));
  const registrations = await (lock
    ? registrationQuery.for("update")
    : registrationQuery);
  const institutions = await db
    .select({ id: institutionRegistration.id })
    .from(institutionRegistration)
    .where(eq(institutionRegistration.competitionId, competitionId))
    .orderBy(asc(institutionRegistration.id));

  const items =
    capturedIds.length === 0
      ? []
      : await db
          .select({
            batchId: paymentBatchItem.batchId,
            registrationId: paymentBatchItem.registrationId,
            amountMinor: paymentBatchItem.amountMinor,
          })
          .from(paymentBatchItem)
          .where(
            and(
              inArray(paymentBatchItem.batchId, capturedIds),
              isNull(paymentBatchItem.releasedAt)
            )
          )
          .orderBy(
            asc(paymentBatchItem.batchId),
            asc(paymentBatchItem.registrationId)
          );
  const held =
    capturedIds.length === 0
      ? []
      : await db
          .select({
            batchId: refundItem.batchId,
            registrationId: refundItem.registrationId,
            refundId: refund.id,
            kind: refund.kind,
            status: refund.status,
            amountMinor: refundItem.amountMinor,
          })
          .from(refundItem)
          .innerJoin(refund, eq(refund.id, refundItem.refundId))
          .where(
            and(
              inArray(refundItem.batchId, capturedIds),
              isNull(refundItem.releasedAt)
            )
          );
  // A live refund also covers registrations it allocated no paise to.
  const zeroShares =
    capturedIds.length === 0
      ? []
      : await db
          .select({
            batchId: refund.batchId,
            registrationId: sql<string>`unnest(${refund.zeroShareRegistrationIds})`,
            refundId: refund.id,
            kind: refund.kind,
            status: refund.status,
            amountMinor: sql<bigint>`0::bigint`.mapWith(BigInt),
          })
          .from(refund)
          .where(
            and(
              inArray(refund.batchId, capturedIds),
              sql`${refund.status} <> 'rejected'`,
              sql`cardinality(${refund.zeroShareRegistrationIds}) > 0`
            )
          );
  const heldBy = new Map(
    [...held, ...zeroShares].map((each) => [
      `${each.batchId}:${each.registrationId}`,
      each,
    ])
  );

  return {
    row,
    input: {
      registrations: registrations.map((each) => ({
        id: each.id,
        standing: standingOf(each.status),
      })),
      institutionRegistrationIds: institutions.map((each) => each.id),
      paidBatches: captured.map(
        ({ id, captureMethod, amountMinor, acceptedReceipt }) => ({
          id,
          method: captureMethod === "offline" ? "offline" : "gateway",
          refundBalanceMinor:
            (acceptedReceipt?.amountMinor ?? amountMinor) -
            (committed.get(id) ?? 0n),
          ...(acceptedReceipt &&
          acceptedReceipt.currency !== "INR" &&
          acceptedReceipt.amountMinor > 0n
            ? { dashboardRefund: acceptedReceipt }
            : { reviewed: acceptedReceipt !== null }),
        })
      ),
      paidItems: items.map((item) => ({
        ...item,
        refund: refundStateOf(
          heldBy.get(`${item.batchId}:${item.registrationId}`)
        ),
      })),
      openBatchIds: batches
        .filter((batch) => batch.status !== "captured")
        .map((batch) => batch.id),
    },
    openBatches: new Map(
      batches
        .filter((batch) => batch.status !== "captured")
        .map((batch) => [batch.id, batch.status])
    ),
    statuses: new Map(registrations.map((each) => [each.id, each.status])),
  };
}

function effectsOf(plan: CancellationPlan): CancellationEffects {
  const dashboardTotals = new Map<string, bigint>();
  for (const { currency, amountMinor } of plan.dashboardRefunds) {
    dashboardTotals.set(
      currency,
      (dashboardTotals.get(currency) ?? 0n) + amountMinor
    );
  }
  return {
    registrationsTold: plan.notify.registrations.length,
    institutionsTold: plan.notify.institutionRegistrations.length,
    registrationsCancelled: plan.cancelRegistrations.length,
    gatewayRefunds: plan.refunds.filter((each) => each.method === "gateway")
      .length,
    manualRefunds: plan.refunds.filter((each) => each.method === "manual")
      .length,
    dashboardRefunds: plan.dashboardRefunds.length,
    dashboardAmounts: [...dashboardTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amountMinor]) => ({ currency, amountMinor })),
    refundMinor: plan.refunds.reduce((sum, each) => sum + each.amountMinor, 0n),
  };
}

/** The competition as the cancel page shows it, and what cancelling does. */
export async function getCompetitionCancellation(
  ctx: UseCaseContext,
  input: { competitionId: string }
): Promise<GetCompetitionCancellationResult> {
  await authorize(
    ctx,
    "competition.cancel.read",
    competitionResource(input.competitionId)
  );
  if (!isCompetitionId(input.competitionId)) {
    return { ok: false, error: "not_found" };
  }
  const loaded = await loadForCancellation(ctx.db, input.competitionId, {
    lock: false,
  });
  if (!loaded) return { ok: false, error: "not_found" };
  const { row } = loaded;
  return {
    ok: true,
    competition: {
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
    },
    effects:
      row.status === "cancelled"
        ? null
        : effectsOf(planCancellation(loaded.input)),
  };
}

export async function cancelCompetition(
  ctx: UseCaseContext,
  input: CancelCompetitionInput
): Promise<CancelCompetitionResult> {
  const { role } = await authorize(ctx, "competition.cancel");
  const parsed = cancelCompetitionInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId } = parsed.data;
  const reason = parsed.data.reason.trim();
  if (reason === "") return { ok: false, error: "reason_required" };
  if (characterCount(reason) > CANCEL_REASON_MAX_LENGTH) {
    return { ok: false, error: "reason_too_long" };
  }
  if (!isCompetitionId(competitionId)) {
    return { ok: false, error: "not_found" };
  }

  return ctx.db.transaction(async (tx): Promise<CancelCompetitionResult> => {
    const loaded = await loadForCancellation(tx, competitionId, {
      lock: true,
    });
    if (!loaded) return { ok: false, error: "not_found" };
    const { row } = loaded;
    if (row.status === "cancelled") {
      return { ok: false, error: "already_cancelled" };
    }
    if (!canTransition(row.status, "cancelled", "cancellation")) {
      throw new Error(`Competition ${competitionId} can't be cancelled`);
    }
    const plan = planCancellation(loaded.input);
    const now = ctx.clock.now();

    await tx
      .update(competition)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelReason: reason,
        updatedAt: now,
      })
      .where(eq(competition.id, competitionId));

    // Release the superseded holds before checking and queuing each batch.
    const superseded = await supersedeDiscretionaryRefunds(
      tx,
      ctx,
      plan.supersede,
      role
    );
    const refundIds: string[] = [];
    for (const planned of plan.refunds) {
      const started = await startSystemRefund(tx, ctx, {
        kind: "cancellation",
        batchId: planned.batchId,
        registrationIds: planned.registrationIds,
        expectedAmountMinor: planned.amountMinor,
        reason,
        idempotencyKey: `cancellation:${competitionId}:${planned.batchId}`,
        actorRole: role,
      });
      if (!("refundId" in started)) {
        throw new Error(
          "Cannot queue a cancellation refund for an eligible batch"
        );
      }
      refundIds.push(started.refundId);
    }
    const dashboardRefundCaseIds = plan.dashboardRefunds.map(
      ({ caseId }) => caseId
    );
    if (dashboardRefundCaseIds.length > 0) {
      // The accepted receipt is the obligation. Keep its original resolution.
      await tx
        .update(paymentReviewCase)
        .set({ refundDue: true })
        .where(inArray(paymentReviewCase.id, dashboardRefundCaseIds));
    }

    for (const registrationId of plan.cancelRegistrations) {
      const from = loaded.statuses.get(registrationId);
      if (!from || !canMoveRegistration(from, "cancelled", "cancellation")) {
        throw new Error(`Registration ${registrationId} can't be cancelled`);
      }
    }
    if (plan.cancelRegistrations.length > 0) {
      await tx
        .update(registration)
        .set({ status: "cancelled", updatedAt: now })
        .where(inArray(registration.id, plan.cancelRegistrations));
    }

    for (const batchId of plan.cancelBatches) {
      const from = loaded.openBatches.get(batchId);
      const move =
        from && nextPaymentBatchStatus(from, "competition_cancelled");
      if (!move?.ok) throw new Error(`Batch ${batchId} can't be cancelled`);
      await tx
        .update(paymentBatch)
        .set({ status: move.to, updatedAt: now })
        .where(eq(paymentBatch.id, batchId));
    }
    if (plan.cancelBatches.length > 0) {
      // Nobody paid for them: they let their students go.
      await tx
        .update(paymentBatchItem)
        .set({ releasedAt: now })
        .where(
          and(
            inArray(paymentBatchItem.batchId, plan.cancelBatches),
            isNull(paymentBatchItem.releasedAt)
          )
        );
    }

    for (const told of plan.notify.registrations) {
      await emit(tx, ctx.clock, {
        type: "registration.competition_cancelled",
        aggregate: { type: "registration", id: told.registrationId },
        payload: {
          registrationId: told.registrationId,
          competitionId,
          refund: told.refund,
          awaitingGuardian:
            loaded.statuses.get(told.registrationId) === "pending_guardian",
        },
      });
    }
    for (const institutionRegistrationId of plan.notify
      .institutionRegistrations) {
      await emit(tx, ctx.clock, {
        type: "institution_registration.competition_cancelled",
        aggregate: {
          type: "institution_registration",
          id: institutionRegistrationId,
        },
        payload: { institutionRegistrationId, competitionId },
      });
    }

    // Its reminders never go (#84).
    await emit(tx, ctx.clock, {
      type: "competition.cancelled",
      aggregate: { type: "competition", id: competitionId },
      payload: { competitionId },
    });

    // Ids and counts only: the reason is the super admin's own words.
    await recordAudit(tx, ctx, {
      action: "competition.cancelled",
      entity: { type: "competition", id: competitionId },
      before: { status: row.status },
      after: {
        status: "cancelled",
        reason,
        refundIds,
        ...(dashboardRefundCaseIds.length > 0
          ? { dashboardRefundCaseIds }
          : {}),
        supersededRefundIds: superseded,
        registrationsCancelled: plan.cancelRegistrations,
        batchesCancelled: plan.cancelBatches,
        registrationsTold: plan.notify.registrations.length,
        institutionsTold: plan.notify.institutionRegistrations.length,
      },
      actorRole: role,
    });
    return { ok: true, status: "cancelled" };
  });
}
