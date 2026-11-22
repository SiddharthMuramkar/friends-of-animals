// Payments needing review, as staff read them (#79).
//
//   listPaymentReviewCases({ state })  → finance, staff admins, super admins
//   getPaymentReviewCase({ caseId })   → the same
//
// A case names its batch, who paid (the institution, or the adult paying
// for their own registration), why it is in review, what the gateway
// captured and, once resolved, how and when. The resolution's free-text
// reason and who resolved it are on the case's own page only.

import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  competition,
  institution,
  paymentBatch,
  paymentReviewCase,
  user,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import type { PaymentBatchStatus } from "./domain/batch-status";
import {
  allowedOutcomes,
  BATCH_STATUSES_BEFORE_REVIEW,
  type BatchStatusBeforeReview,
  type PaymentReviewOutcome,
  type PaymentReviewReason,
} from "./domain/review-case";

/** How many cases one list shows; the oldest beyond it wait their turn. */
export const REVIEW_LIST_LIMIT = 100;

export type PaymentReviewPayer =
  | { kind: "institution"; name: string }
  | { kind: "person"; name: string }
  /** The payer's account is gone. */
  | null;

export type PaymentReviewCaseItem = {
  id: string;
  batchId: string;
  reason: PaymentReviewReason;
  gatewayPaymentId: string | null;
  /** What the gateway captured, in paise. */
  amountMinor: bigint;
  currency: string;
  openedAt: Date;
  payer: PaymentReviewPayer;
  competitionName: string;
  resolution: {
    outcome: PaymentReviewOutcome;
    resolvedAt: Date;
    refundDue: boolean;
  } | null;
};

export type ListPaymentReviewCasesInput = { state: "open" | "resolved" };

export type ListPaymentReviewCasesResult =
  | { ok: true; cases: PaymentReviewCaseItem[] }
  | InvalidInput;

const payerUser = alias(user, "payer_user");

const ITEM_COLUMNS = {
  id: paymentReviewCase.id,
  batchId: paymentReviewCase.batchId,
  reason: paymentReviewCase.reason,
  gatewayPaymentId: paymentReviewCase.gatewayPaymentId,
  amountMinor: paymentReviewCase.amountMinor,
  currency: paymentReviewCase.currency,
  openedAt: paymentReviewCase.openedAt,
  outcome: paymentReviewCase.outcome,
  resolvedAt: paymentReviewCase.resolvedAt,
  refundDue: paymentReviewCase.refundDue,
  institutionName: institution.name,
  payerName: payerUser.name,
  competitionName: competition.name,
};

type ItemRow = {
  [K in keyof typeof ITEM_COLUMNS]:
    | (typeof ITEM_COLUMNS)[K]["_"]["data"]
    | null;
};

function itemOf(row: ItemRow): PaymentReviewCaseItem {
  const payer: PaymentReviewPayer =
    row.institutionName !== null
      ? { kind: "institution", name: row.institutionName }
      : row.payerName !== null
        ? { kind: "person", name: row.payerName }
        : null;
  return {
    id: row.id!,
    batchId: row.batchId!,
    reason: row.reason!,
    gatewayPaymentId: row.gatewayPaymentId,
    amountMinor: row.amountMinor!,
    currency: row.currency!,
    openedAt: row.openedAt!,
    payer,
    competitionName: row.competitionName!,
    resolution:
      row.outcome !== null && row.resolvedAt !== null
        ? {
            outcome: row.outcome,
            resolvedAt: row.resolvedAt,
            refundDue: row.refundDue ?? false,
          }
        : null,
  };
}

function caseQuery(ctx: UseCaseContext) {
  return ctx.db
    .select(ITEM_COLUMNS)
    .from(paymentReviewCase)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .leftJoin(payerUser, eq(payerUser.id, paymentBatch.payerUserId));
}

const listInput = z.object({ state: z.enum(["open", "resolved"]) });

export async function listPaymentReviewCases(
  ctx: UseCaseContext,
  input: ListPaymentReviewCasesInput
): Promise<ListPaymentReviewCasesResult> {
  await authorize(ctx, "payments.review.read");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const rows = await caseQuery(ctx)
    .where(
      parsed.data.state === "open"
        ? isNull(paymentReviewCase.resolvedAt)
        : isNotNull(paymentReviewCase.resolvedAt)
    )
    .orderBy(desc(paymentReviewCase.openedAt), desc(paymentReviewCase.id))
    .limit(REVIEW_LIST_LIMIT);
  return { ok: true, cases: rows.map(itemOf) };
}

export type PaymentReviewCaseView = PaymentReviewCaseItem & {
  batchStatus: PaymentBatchStatus;
  batchStatusBefore: BatchStatusBeforeReview;
  batchAmountMinor: bigint;
  /** What staff may choose; empty once resolved. */
  allowedOutcomes: readonly PaymentReviewOutcome[];
  /** Other unresolved cases on the same batch. */
  otherOpenCases: number;
  resolutionReason: string | null;
  /** Who resolved it; null while open or once their account is gone. */
  resolvedByName: string | null;
};

export type GetPaymentReviewCaseInput = { caseId: string };

export type GetPaymentReviewCaseResult =
  | { ok: true; reviewCase: PaymentReviewCaseView }
  | InvalidInput
  | { ok: false; error: "not_found" };

const caseInput = z.object({ caseId: z.uuid() });

const resolver = alias(user, "resolver");

function isBeforeReview(status: string): status is BatchStatusBeforeReview {
  return (BATCH_STATUSES_BEFORE_REVIEW as readonly string[]).includes(status);
}

export async function getPaymentReviewCase(
  ctx: UseCaseContext,
  input: GetPaymentReviewCaseInput
): Promise<GetPaymentReviewCaseResult> {
  await authorize(ctx, "payments.review.read");
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { caseId } = parsed.data;
  const [row] = await caseQuery(ctx)
    .where(eq(paymentReviewCase.id, caseId))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  const [details] = await ctx.db
    .select({
      batchStatus: paymentBatch.status,
      batchAmountMinor: paymentBatch.amountMinor,
      batchStatusBefore: paymentReviewCase.batchStatusBefore,
      resolutionReason: paymentReviewCase.resolutionReason,
      resolvedByName: resolver.name,
    })
    .from(paymentReviewCase)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
    .leftJoin(resolver, eq(resolver.id, paymentReviewCase.resolvedByUserId))
    .where(eq(paymentReviewCase.id, caseId));
  if (!details || !isBeforeReview(details.batchStatusBefore)) {
    throw new Error(`Review case ${caseId} has no batch status before review`);
  }
  const [others] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentReviewCase)
    .where(
      and(
        eq(paymentReviewCase.batchId, row.batchId),
        ne(paymentReviewCase.id, caseId),
        isNull(paymentReviewCase.resolvedAt)
      )
    );
  const item = itemOf(row);
  return {
    ok: true,
    reviewCase: {
      ...item,
      batchStatus: details.batchStatus,
      batchStatusBefore: details.batchStatusBefore,
      batchAmountMinor: details.batchAmountMinor,
      allowedOutcomes: item.resolution
        ? []
        : allowedOutcomes({
            reason: item.reason,
            batchStatusBefore: details.batchStatusBefore,
          }),
      otherOpenCases: others?.count ?? 0,
      resolutionReason: details.resolutionReason,
      resolvedByName: details.resolvedByName,
    },
  };
}
