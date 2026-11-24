// Refunds as staff read them (#80).
//
//   listRefunds({ state })          → finance, staff admins, super admins,
//                                     competition managers of every
//                                     competition
//   getRefund({ refundId })         → the same, or a manager of that
//                                     refund's competition
//   getRefundableBatch({ batchId }) → whoever may ask for its refund: what
//                                     the request page needs
//
// Students are named by registration number and standing, never by name:
// finance matches money, not children (as #79's batch page does). The
// requester's reason and finance's note are on the refund's own page only.

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { authorize, can } from "../../../access/can";
import {
  auditLog,
  competition,
  institution,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  refund,
  refundItem,
  registration,
  user,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { RegistrationStatus } from "../../registration/domain/registration-status";
import type {
  PaymentBatchStatus,
  PaymentCaptureMethod,
} from "../domain/batch-status";
import type { OfflinePaymentMethod } from "../domain/offline-payment";
import type { ItemRefundState } from "../domain/refund-plan";
import {
  requiresCancellationPayout,
  SUPERSEDED_BY_CANCELLATION,
  type RefundKind,
  type RefundMethod,
  type RefundStatus,
} from "../domain/refund-status";
import type { PaymentReviewPayer } from "../review-cases";
import { batchResource } from "./request-refund";
import { acceptedReviewOfBatch, refundableBatch } from "./rows";

/** How many refunds one list shows; older ones wait their turn. */
export const REFUND_LIST_LIMIT = 100;

/** The finance queue's tabs, by status. */
export const REFUND_LIST_STATES = ["waiting", "in_progress", "done"] as const;

export type RefundListState = (typeof REFUND_LIST_STATES)[number];

const STATUSES_OF: Record<RefundListState, RefundStatus[]> = {
  waiting: ["requested"],
  in_progress: ["approved", "processing", "failed"],
  done: ["refunded", "rejected"],
};

export type RefundListItem = {
  id: string;
  batchId: string;
  kind: RefundKind;
  status: RefundStatus;
  method: RefundMethod;
  amountMinor: bigint;
  requestedAt: Date;
  payer: PaymentReviewPayer;
  competitionName: string;
  /** How many students it lists; none for a duplicate. */
  students: number;
};

export type RefundView = RefundListItem & {
  reason: string;
  /** Null for the system's own, or once their account is gone. */
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  supersededByCancellation: boolean;
  requiredByCancellation: boolean;
  gatewayPaymentId: string | null;
  gatewayRefundId: string | null;
  attempt: number;
  sentAt: Date | null;
  refundedAt: Date | null;
  failedAt: Date | null;
  manualMethod: OfflinePaymentMethod | null;
  manualReference: string | null;
  reviewCaseId: string | null;
  batchAmountMinor: bigint;
  batchCurrency: string;
  /** The institution registration's reference; null on the individual route. */
  reference: string | null;
  items: {
    registrationId: string;
    registrationNumber: string | null;
    status: RegistrationStatus;
    amountMinor: bigint;
    /** Let go by a rejection: no longer part of the refund. */
    released: boolean;
  }[];
  /** What the viewer may do: decide it, and whether they asked for it. */
  viewer: { mayDecide: boolean; isRequester: boolean };
};

export type ListRefundsInput = { state: RefundListState };

export type ListRefundsResult =
  | { ok: true; refunds: RefundListItem[] }
  | InvalidInput;

export type GetRefundInput = { refundId: string };

export type GetRefundResult =
  | { ok: true; refund: RefundView }
  | InvalidInput
  | { ok: false; error: "not_found" };

export type RefundableBatch = {
  id: string;
  status: PaymentBatchStatus;
  captureMethod: PaymentCaptureMethod | null;
  amountMinor: bigint;
  currency: string;
  payout:
    | { kind: "inr" }
    | {
        kind: "dashboard";
        reviewCaseId: string | null;
        state: "review" | "required" | "recorded";
      };
  competitionName: string;
  payer: PaymentReviewPayer;
  reference: string | null;
  items: {
    registrationId: string;
    registrationNumber: string | null;
    status: RegistrationStatus;
    amountMinor: bigint;
    refund: ItemRefundState;
  }[];
  refunds: {
    id: string;
    kind: RefundKind;
    status: RefundStatus;
    amountMinor: bigint;
    requestedAt: Date;
  }[];
};

export type GetRefundableBatchInput = { batchId: string };

export type GetRefundableBatchResult =
  | { ok: true; batch: RefundableBatch }
  | InvalidInput
  | { ok: false; error: "not_found" };

const payerUser = alias(user, "payer_user");
const requester = alias(user, "requester");
const decider = alias(user, "decider");

function payerOf(row: {
  institutionName: string | null;
  payerName: string | null;
}): PaymentReviewPayer {
  return row.institutionName !== null
    ? { kind: "institution", name: row.institutionName }
    : row.payerName !== null
      ? { kind: "person", name: row.payerName }
      : null;
}

const LIST_COLUMNS = {
  id: refund.id,
  batchId: refund.batchId,
  kind: refund.kind,
  status: refund.status,
  method: refund.method,
  amountMinor: refund.amountMinor,
  requestedAt: refund.requestedAt,
  competitionName: competition.name,
  institutionName: institution.name,
  payerName: payerUser.name,
  zeroShareCount: sql<number>`cardinality(${refund.zeroShareRegistrationIds})`,
};

function listQuery(ctx: UseCaseContext) {
  return ctx.db
    .select(LIST_COLUMNS)
    .from(refund)
    .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .leftJoin(payerUser, eq(payerUser.id, paymentBatch.payerUserId));
}

async function studentCounts(
  ctx: UseCaseContext,
  refundIds: string[]
): Promise<Map<string, number>> {
  if (refundIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ refundId: refundItem.refundId, students: count() })
    .from(refundItem)
    .where(inArray(refundItem.refundId, refundIds))
    .groupBy(refundItem.refundId);
  return new Map(rows.map((row) => [row.refundId, row.students]));
}

const listInput = z.strictObject({ state: z.enum(REFUND_LIST_STATES) });

export async function listRefunds(
  ctx: UseCaseContext,
  input: ListRefundsInput
): Promise<ListRefundsResult> {
  await authorize(ctx, "refunds.read");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const rows = await listQuery(ctx)
    .where(inArray(refund.status, STATUSES_OF[parsed.data.state]))
    .orderBy(desc(refund.requestedAt), desc(refund.id))
    .limit(REFUND_LIST_LIMIT);
  const students = await studentCounts(
    ctx,
    rows.map((row) => row.id)
  );
  return {
    ok: true,
    refunds: rows.map((row) => ({
      id: row.id,
      batchId: row.batchId,
      kind: row.kind,
      status: row.status,
      method: row.method,
      amountMinor: row.amountMinor,
      requestedAt: row.requestedAt,
      payer: payerOf(row),
      competitionName: row.competitionName,
      students: (students.get(row.id) ?? 0) + row.zeroShareCount,
    })),
  };
}

const getInput = z.strictObject({ refundId: z.uuid() });

export async function getRefund(
  ctx: UseCaseContext,
  input: GetRefundInput
): Promise<GetRefundResult> {
  const parsed = getInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "refunds.read");
    return invalidInput(parsed.error);
  }
  const [found] = await ctx.db
    .select({ batchId: refund.batchId })
    .from(refund)
    .where(eq(refund.id, parsed.data.refundId));
  const { resource } = found
    ? await batchResource(ctx, found.batchId)
    : { resource: {} };
  await authorize(ctx, "refunds.read", resource);
  if (!found) return { ok: false, error: "not_found" };

  const [row] = await ctx.db
    .select({
      ...LIST_COLUMNS,
      reason: refund.reason,
      requestedBy: refund.requestedBy,
      requestedByName: requester.name,
      decidedByName: decider.name,
      decidedAt: refund.decidedAt,
      decisionNote: refund.decisionNote,
      competitionStatus: competition.status,
      supersededByCancellation: exists(
        ctx.db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entityType, "refund"),
              eq(auditLog.entityId, parsed.data.refundId),
              eq(auditLog.action, "refund.rejected"),
              sql`${auditLog.after}->>'reason' = ${SUPERSEDED_BY_CANCELLATION}`
            )
          )
      ),
      gatewayPaymentId: refund.gatewayPaymentId,
      gatewayRefundId: refund.gatewayRefundId,
      attempt: refund.attempt,
      sentAt: refund.sentAt,
      refundedAt: refund.refundedAt,
      failedAt: refund.failedAt,
      manualMethod: refund.manualMethod,
      manualReference: refund.manualReference,
      reviewCaseId: refund.reviewCaseId,
      zeroShareRegistrationIds: refund.zeroShareRegistrationIds,
      batchAmountMinor: paymentBatch.amountMinor,
      batchCurrency: paymentBatch.currency,
      acceptedReceipt: {
        amountMinor: paymentReviewCase.amountMinor,
        currency: paymentReviewCase.currency,
      },
      reference: institutionRegistration.reference,
    })
    .from(refund)
    .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
    .leftJoin(paymentReviewCase, acceptedReviewOfBatch)
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .leftJoin(payerUser, eq(payerUser.id, paymentBatch.payerUserId))
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, paymentBatch.institutionRegistrationId)
    )
    .leftJoin(requester, eq(requester.id, refund.requestedBy))
    .leftJoin(decider, eq(decider.id, refund.decidedBy))
    .where(eq(refund.id, parsed.data.refundId));
  if (!row) return { ok: false, error: "not_found" };
  const items = await ctx.db
    .select({
      registrationId: refundItem.registrationId,
      registrationNumber: registration.registrationNumber,
      status: registration.status,
      amountMinor: refundItem.amountMinor,
      releasedAt: refundItem.releasedAt,
    })
    .from(refundItem)
    .innerJoin(registration, eq(registration.id, refundItem.registrationId))
    .where(eq(refundItem.refundId, row.id))
    .orderBy(asc(refundItem.registrationId));
  if (row.zeroShareRegistrationIds.length > 0) {
    const covered = await ctx.db
      .select({
        registrationId: registration.id,
        registrationNumber: registration.registrationNumber,
        status: registration.status,
      })
      .from(registration)
      .where(inArray(registration.id, row.zeroShareRegistrationIds));
    items.push(
      ...covered.map((item) => ({
        ...item,
        amountMinor: 0n,
        releasedAt: row.status === "rejected" ? row.decidedAt : null,
      }))
    );
    items.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  }
  // Holding finance, whatever their second factor's age: the page then
  // offers the decision, and the use case asks for a fresh one.
  const decision = await can(ctx, "refunds.decide", resource);
  const viewerId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  return {
    ok: true,
    refund: {
      id: row.id,
      batchId: row.batchId,
      kind: row.kind,
      status: row.status,
      method: row.method,
      amountMinor: row.amountMinor,
      requestedAt: row.requestedAt,
      payer: payerOf(row),
      competitionName: row.competitionName,
      students: items.filter((item) => item.releasedAt === null).length,
      reason: row.reason,
      requestedByName: row.requestedByName,
      decidedByName: row.decidedByName,
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
      supersededByCancellation: row.supersededByCancellation === true,
      requiredByCancellation:
        row.status === "failed" &&
        requiresCancellationPayout(row.kind, row.competitionStatus),
      gatewayPaymentId: row.gatewayPaymentId,
      gatewayRefundId: row.gatewayRefundId,
      attempt: row.attempt,
      sentAt: row.sentAt,
      refundedAt: row.refundedAt,
      failedAt: row.failedAt,
      manualMethod: row.manualMethod,
      manualReference: row.manualReference,
      reviewCaseId: row.reviewCaseId,
      batchAmountMinor:
        row.acceptedReceipt?.amountMinor ?? row.batchAmountMinor,
      batchCurrency: row.acceptedReceipt?.currency ?? row.batchCurrency,
      reference: row.reference,
      items: items.map((item) => ({
        registrationId: item.registrationId,
        registrationNumber: item.registrationNumber,
        status: item.status,
        amountMinor: item.amountMinor,
        released: item.releasedAt !== null,
      })),
      viewer: {
        mayDecide: decision.allowed || "secondFactor" in decision,
        isRequester: viewerId !== null && viewerId === row.requestedBy,
      },
    },
  };
}

const batchInput = z.strictObject({ batchId: z.uuid() });

export async function getRefundableBatch(
  ctx: UseCaseContext,
  input: GetRefundableBatchInput
): Promise<GetRefundableBatchResult> {
  const parsed = batchInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "refunds.request");
    return invalidInput(parsed.error);
  }
  const { resource, found } = await batchResource(ctx, parsed.data.batchId);
  await authorize(ctx, "refunds.request", resource);
  if (!found) return { ok: false, error: "not_found" };
  const [row] = await ctx.db
    .select({
      id: paymentBatch.id,
      status: paymentBatch.status,
      captureMethod: paymentBatch.captureMethod,
      gatewayPaymentId: paymentBatch.gatewayPaymentId,
      amountMinor: paymentBatch.amountMinor,
      competitionName: competition.name,
      institutionName: institution.name,
      payerName: payerUser.name,
      reference: institutionRegistration.reference,
    })
    .from(paymentBatch)
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .leftJoin(payerUser, eq(payerUser.id, paymentBatch.payerUserId))
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, paymentBatch.institutionRegistrationId)
    )
    .where(eq(paymentBatch.id, parsed.data.batchId));
  if (!row) return { ok: false, error: "not_found" };
  const available = await refundableBatch(ctx.db, row);
  const states = new Map(available.items.map((item) => [item.id, item]));
  const payout: RefundableBatch["payout"] =
    available.kind === "dashboard"
      ? {
          kind: "dashboard",
          reviewCaseId: (await can(ctx, "payments.review.read")).allowed
            ? available.reviewCaseId
            : null,
          state: available.state,
        }
      : { kind: "inr" };
  const students = await ctx.db
    .select({
      registrationId: paymentBatchItem.registrationId,
      registrationNumber: registration.registrationNumber,
      status: registration.status,
    })
    .from(paymentBatchItem)
    .innerJoin(
      registration,
      eq(registration.id, paymentBatchItem.registrationId)
    )
    .where(
      and(
        eq(paymentBatchItem.batchId, row.id),
        isNull(paymentBatchItem.releasedAt)
      )
    )
    .orderBy(asc(paymentBatchItem.registrationId));
  const refunds = await ctx.db
    .select({
      id: refund.id,
      kind: refund.kind,
      status: refund.status,
      amountMinor: refund.amountMinor,
      requestedAt: refund.requestedAt,
    })
    .from(refund)
    .where(eq(refund.batchId, row.id))
    .orderBy(desc(refund.requestedAt), desc(refund.id));
  return {
    ok: true,
    batch: {
      id: row.id,
      status: row.status,
      captureMethod: row.captureMethod,
      amountMinor: available.amountMinor,
      currency: available.currency,
      payout,
      competitionName: row.competitionName,
      payer: payerOf(row),
      reference: row.reference,
      items: students.map((student) => ({
        ...student,
        amountMinor: states.get(student.registrationId)?.amountMinor ?? 0n,
        refund: states.get(student.registrationId)?.refund ?? "none",
      })),
      refunds,
    },
  };
}
