// getPaymentBatchForStaff({ batchId }) (#79): a payment batch as finance,
// staff admins and super admins see it: what it is for and who pays it,
// its status and how it was paid, its students' standing (numbers, not
// names: finance matches money, not children), the offline payment it
// was paid with, its review cases, and whether an offline payment may be
// recorded against it now.

import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  competition,
  fileAsset,
  institution,
  institutionRegistration,
  offlinePayment,
  paymentBatch,
  paymentBatchItem,
  paymentReviewCase,
  registration,
  user,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import type { FileStatus } from "../files/domain/file-status";
import type { ParticipationRoute } from "../competitions/domain/fees";
import type { RegistrationStatus } from "../registration/domain/registration-status";
import {
  nextPaymentBatchStatus,
  type PaymentBatchStatus,
  type PaymentCaptureMethod,
} from "./domain/batch-status";
import type { OfflinePaymentMethod } from "./domain/offline-payment";
import type {
  PaymentReviewOutcome,
  PaymentReviewReason,
} from "./domain/review-case";
import type { PaymentReviewPayer } from "./review-cases";
import { acceptedReviewOfBatch } from "./refunds/rows";

export type StaffPaymentBatch = {
  id: string;
  status: PaymentBatchStatus;
  route: ParticipationRoute;
  amountMinor: bigint;
  currency: string;
  /** The actual receipt when finance accepted a reviewed capture. */
  acceptedReceipt: { amountMinor: bigint; currency: string } | null;
  competitionName: string;
  payer: PaymentReviewPayer;
  /** The institution registration's reference; null on the individual route. */
  reference: string | null;
  createdAt: Date;
  capturedAt: Date | null;
  captureMethod: PaymentCaptureMethod | null;
  gatewayPaymentId: string | null;
  /** Whether recordOfflinePayment may take it now. */
  canRecordOffline: boolean;
  students: {
    registrationId: string;
    registrationNumber: string | null;
    status: RegistrationStatus;
    /** Whether this batch still holds the registration. */
    held: boolean;
  }[];
  offlinePayment: {
    method: OfflinePaymentMethod;
    reference: string;
    amountMinor: bigint;
    receivedOn: string;
    recordedAt: Date;
    recordedByName: string | null;
    proofStatus: FileStatus;
  } | null;
  reviewCases: {
    id: string;
    reason: PaymentReviewReason;
    openedAt: Date;
    outcome: PaymentReviewOutcome | null;
  }[];
};

export type GetPaymentBatchForStaffInput = { batchId: string };

export type GetPaymentBatchForStaffResult =
  | { ok: true; batch: StaffPaymentBatch }
  | InvalidInput
  | { ok: false; error: "not_found" };

const batchInput = z.object({ batchId: z.uuid() });

const payerUser = alias(user, "payer_user");
const recorder = alias(user, "recorder");

export async function getPaymentBatchForStaff(
  ctx: UseCaseContext,
  input: GetPaymentBatchForStaffInput
): Promise<GetPaymentBatchForStaffResult> {
  await authorize(ctx, "payments.review.read");
  const parsed = batchInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { batchId } = parsed.data;
  const [row] = await ctx.db
    .select({
      id: paymentBatch.id,
      status: paymentBatch.status,
      route: paymentBatch.route,
      amountMinor: paymentBatch.amountMinor,
      currency: paymentBatch.currency,
      acceptedReceipt: {
        amountMinor: paymentReviewCase.amountMinor,
        currency: paymentReviewCase.currency,
      },
      createdAt: paymentBatch.createdAt,
      capturedAt: paymentBatch.capturedAt,
      captureMethod: paymentBatch.captureMethod,
      gatewayPaymentId: paymentBatch.gatewayPaymentId,
      competitionName: competition.name,
      institutionName: institution.name,
      payerName: payerUser.name,
      reference: institutionRegistration.reference,
    })
    .from(paymentBatch)
    .leftJoin(paymentReviewCase, acceptedReviewOfBatch)
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, paymentBatch.institutionRegistrationId)
    )
    .leftJoin(payerUser, eq(payerUser.id, paymentBatch.payerUserId))
    .where(eq(paymentBatch.id, batchId));
  if (!row) return { ok: false, error: "not_found" };

  const students = await ctx.db
    .select({
      registrationId: paymentBatchItem.registrationId,
      registrationNumber: registration.registrationNumber,
      status: registration.status,
      releasedAt: paymentBatchItem.releasedAt,
    })
    .from(paymentBatchItem)
    .innerJoin(
      registration,
      eq(registration.id, paymentBatchItem.registrationId)
    )
    .where(eq(paymentBatchItem.batchId, batchId))
    .orderBy(asc(paymentBatchItem.registrationId));
  const [offline] = await ctx.db
    .select({
      method: offlinePayment.method,
      reference: offlinePayment.reference,
      amountMinor: offlinePayment.amountMinor,
      receivedOn: offlinePayment.receivedOn,
      recordedAt: offlinePayment.recordedAt,
      recordedByName: recorder.name,
      proofStatus: fileAsset.status,
    })
    .from(offlinePayment)
    .innerJoin(fileAsset, eq(fileAsset.id, offlinePayment.proofFileAssetId))
    .leftJoin(recorder, eq(recorder.id, offlinePayment.recordedByUserId))
    .where(eq(offlinePayment.batchId, batchId));
  const cases = await ctx.db
    .select({
      id: paymentReviewCase.id,
      reason: paymentReviewCase.reason,
      openedAt: paymentReviewCase.openedAt,
      outcome: paymentReviewCase.outcome,
    })
    .from(paymentReviewCase)
    .where(eq(paymentReviewCase.batchId, batchId))
    .orderBy(desc(paymentReviewCase.openedAt), desc(paymentReviewCase.id));

  const { institutionName, payerName, ...batch } = row;
  return {
    ok: true,
    batch: {
      ...batch,
      payer:
        institutionName !== null
          ? { kind: "institution", name: institutionName }
          : payerName !== null
            ? { kind: "person", name: payerName }
            : null,
      canRecordOffline: nextPaymentBatchStatus(row.status, "offline_recorded")
        .ok,
      students: students.map(({ releasedAt, ...student }) => ({
        ...student,
        held: releasedAt === null,
      })),
      offlinePayment: offline ?? null,
      reviewCases: cases,
    },
  };
}
