// requestRefund({ batchId, registrationIds?, reason }) (#80): a competition
// manager (of the batch's competition, or of all) or a staff admin asks
// for a captured batch's money back: every student it has left, or the
// ones listed (a partial refund), with a reason of 1 to 500 characters.
// The refund waits, `requested`, for finance to approve or reject it
// (./decide-refund.ts); nothing goes to the gateway here.
//
// The input is strict: a request can't name its kind or status, so a
// discretionary refund can't skip approval. Cancellation and duplicate
// refunds are made by the system (./start-system-refund.ts), never through
// `as(actor)`.
//
// A batch paid offline (#79) is paid back by hand: its refund's method is
// manual, and finance records how once it is approved.

import { eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Resource } from "../../../access/domain/policy";
import { paymentBatch, refund, refundItem } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { lockBatch } from "../batches";
import {
  planRefund,
  splitRefundCoverage,
  type RefundPlan,
} from "../domain/refund-plan";
import { initialRefundStatus } from "../domain/refund-status";
import { auditRefund, checkRefundText, refundableBatch } from "./rows";

export type RequestRefundInput = {
  batchId: string;
  /** Leave out for every student the batch has left. */
  registrationIds?: string[];
  reason: string;
};

type PlanRefusal = Extract<RefundPlan, { ok: false }>;

/** A plan's refusal, as the use case reports it. */
type Refusal = PlanRefusal extends infer R
  ? R extends { reason: infer E }
    ? Omit<R, "reason"> & { error: E }
    : never
  : never;

function refusalOf(plan: PlanRefusal): Refusal {
  const { reason, ...rest } = plan;
  return { ...rest, error: reason } as Refusal;
}

class RefundItemTaken extends Error {
  readonly registrationId: string;

  constructor(registrationId: string) {
    super("A live refund already holds this registration");
    this.registrationId = registrationId;
  }
}

export type RequestRefundResult =
  | {
      ok: true;
      refundId: string;
      amountMinor: bigint;
      /** As asked; batch order for a whole-batch refund. */
      registrationIds: string[];
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "reason_required"
        | "reason_too_long"
        | "dashboard_managed";
    }
  | Refusal;

const requestInput = z.strictObject({
  batchId: z.uuid(),
  registrationIds: z.array(z.uuid()).max(1000).optional(),
  // Generous: the reason is counted as a reader counts it below.
  reason: z.string().max(4000),
});

/** The scopes a refund of the batch sits in: its competition, or none for
 * a donation's batch (#106), which only global grants cover. */
export async function batchResource(
  ctx: UseCaseContext,
  batchId: string
): Promise<{ resource: Resource; found: boolean }> {
  const [batch] = await ctx.db
    .select({ competitionId: paymentBatch.competitionId })
    .from(paymentBatch)
    .where(eq(paymentBatch.id, batchId));
  if (!batch) return { resource: {}, found: false };
  return {
    resource:
      batch.competitionId === null
        ? {}
        : { scopes: [{ type: "competition", id: batch.competitionId }] },
    found: true,
  };
}

export async function requestRefund(
  ctx: UseCaseContext,
  input: RequestRefundInput
): Promise<RequestRefundResult> {
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "refunds.request");
    return invalidInput(parsed.error);
  }
  const { batchId, registrationIds } = parsed.data;
  const { resource, found } = await batchResource(ctx, batchId);
  const { role } = await authorize(ctx, "refunds.request", resource);
  if (!found) return { ok: false, error: "not_found" };
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const requestedBy = ctx.actor.userId;
  const reason = checkRefundText(parsed.data.reason, { required: true });
  if (!reason.ok) {
    return {
      ok: false,
      error:
        reason.error === "required" ? "reason_required" : "reason_too_long",
    };
  }

  try {
    return await ctx.db.transaction(
      async (tx): Promise<RequestRefundResult> => {
        // One request at a time per batch, so two can't list one student.
        const batch = await lockBatch(tx, batchId);
        if (!batch) return { ok: false, error: "not_found" };
        // Sale reversals are not registration refunds; no silent adjustment of the creator liability.
        if (batch.purpose === "auction_sale")
          return { ok: false, error: "nothing_to_refund" };
        const available = await refundableBatch(tx, batch);
        if (available.kind === "dashboard") {
          return { ok: false, error: "dashboard_managed" };
        }
        const plan = planRefund(
          available,
          registrationIds === undefined ? {} : { registrationIds }
        );
        if (!plan.ok) return refusalOf(plan);

        const { payableItems, zeroShareRegistrationIds } = splitRefundCoverage(
          available.items,
          plan.registrationIds
        );

        const now = ctx.clock.now();
        const refundId = uuidv7(now);
        const manual = batch.captureMethod === "offline";
        const status = initialRefundStatus("discretionary");
        await tx.insert(refund).values({
          id: refundId,
          batchId: batch.id,
          gatewayPaymentId: manual ? null : batch.gatewayPaymentId,
          kind: "discretionary",
          status,
          method: manual ? "manual" : "gateway",
          amountMinor: plan.amountMinor,
          zeroShareRegistrationIds,
          currency: plan.currency,
          reason: reason.text ?? "",
          requestedBy,
          requestedAt: now,
          updatedAt: now,
        });
        const inserted = await tx
          .insert(refundItem)
          .values(
            payableItems.map((item) => ({
              ...item,
              refundId,
              batchId: batch.id,
            }))
          )
          .onConflictDoNothing({
            target: refundItem.registrationId,
            where: isNull(refundItem.releasedAt),
          })
          .returning({ registrationId: refundItem.registrationId });
        // The unique index skips any item another live refund holds. Roll
        // back the entire request and name a student it actually skipped.
        const held = new Set(inserted.map((item) => item.registrationId));
        const taken = payableItems.find(
          ({ registrationId }) => !held.has(registrationId)
        );
        if (taken) throw new RefundItemTaken(taken.registrationId);
        await auditRefund(
          tx,
          ctx,
          refundId,
          {
            action: "refund.requested",
            before: null,
            after: {
              batchId: batch.id,
              kind: "discretionary",
              status,
              method: manual ? "manual" : "gateway",
              amountMinor: plan.amountMinor.toString(),
              registrationIds: plan.registrationIds,
            },
          },
          role
        );
        return {
          ok: true,
          refundId,
          amountMinor: plan.amountMinor,
          registrationIds: plan.registrationIds,
        };
      }
    );
  } catch (error) {
    if (error instanceof RefundItemTaken) {
      return {
        ok: false,
        error: "item_in_live_refund",
        registrationId: error.registrationId,
      };
    }
    throw error;
  }
}
