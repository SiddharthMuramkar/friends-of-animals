// Finance's donations (#106).
//
//   listDonations          the newest donations, filtered by status, donor
//                          type and IST dates: finance only.
//   getDonation            one donation with its donor, receipt, payment,
//                          refunds and review cases: finance only.
//   requestDonationRefund  asks for everything left of a donation's money
//                          back: finance, staff admin or super admin. It
//                          waits, `requested`, for finance to approve it
//                          through the refunds module (approveRefund),
//                          and nobody decides their own request. Donations
//                          are refunded whole: what is left, at once.
//
// Donors' names and emails are personal data: decrypted for finance here
// and nowhere else on screen.

import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import {
  donation,
  donor,
  fileAsset,
  paymentBatch,
  paymentReviewCase,
  receipt,
  refund,
} from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { lockBatch } from "../payments/batches";
import type { PaymentBatchStatus } from "../payments/domain/batch-status";
import type {
  PaymentReviewOutcome,
  PaymentReviewReason,
} from "../payments/domain/review-case";
import {
  initialRefundStatus,
  type RefundKind,
  type RefundStatus,
} from "../payments/domain/refund-status";
import {
  auditRefund,
  checkRefundText,
  refundableBatch,
} from "../payments/refunds/rows";
import { istDateRange } from "../ledger/domain/period";
import {
  DONATION_STATUSES,
  holdsMoney,
  type DonationStatus,
} from "./domain/donation-status";
import { DONOR_TYPES, type DonorType } from "./domain/donor";
import { donorContact } from "./donors";
import type { OfflinePaymentMethod } from "../payments/domain/offline-payment";
import type { FileStatus } from "../files/domain/file-status";

/** The most donations one list shows. */
export const DONATION_LIST_LIMIT = 200;

export type DonationListItem = {
  id: string;
  createdAt: Date;
  amountMinor: bigint;
  status: DonationStatus;
  donorType: DonorType;
  donorName: string;
  organisationName: string | null;
  receiptNumber: string | null;
  guest: boolean;
};

export type ListDonationsInput = {
  status?: string;
  donorType?: string;
  /** IST calendar dates, `YYYY-MM-DD`, both included. */
  from?: string;
  to?: string;
};

export type ListDonationsResult =
  | { ok: true; donations: DonationListItem[]; limited: boolean }
  | InvalidInput
  | { ok: false; error: "invalid_date" | "range_reversed" };

const empty = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const listInput = z.strictObject({
  status: z.preprocess(empty, z.enum(DONATION_STATUSES).optional()),
  donorType: z.preprocess(empty, z.enum(DONOR_TYPES).optional()),
  from: z.preprocess(empty, z.string().max(10).optional()),
  to: z.preprocess(empty, z.string().max(10).optional()),
});

export async function listDonations(
  ctx: UseCaseContext,
  input: ListDonationsInput = {}
): Promise<ListDonationsResult> {
  await authorize(ctx, "donation.read");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { status, donorType, from, to } = parsed.data;
  const where: (SQL | undefined)[] = [
    status ? eq(donation.status, status) : undefined,
    donorType ? eq(donor.type, donorType) : undefined,
  ];
  const range = istDateRange({ from, to });
  if (!range.ok) return { ok: false, error: range.error };
  if (range.fromInclusive) {
    where.push(gte(donation.createdAt, range.fromInclusive));
  }
  if (range.toExclusive) where.push(lt(donation.createdAt, range.toExclusive));

  const rows = await ctx.db
    .select({
      id: donation.id,
      createdAt: donation.createdAt,
      amountMinor: donation.amountMinor,
      status: donation.status,
      donorType: donor.type,
      name: donor.name,
      email: donor.email,
      organisationName: donor.organisationName,
      userId: donor.userId,
      receiptNumber: receipt.number,
    })
    .from(donation)
    .innerJoin(donor, eq(donor.id, donation.donorId))
    .leftJoin(receipt, eq(receipt.donationId, donation.id))
    .where(and(...where))
    .orderBy(desc(donation.createdAt), desc(donation.id))
    .limit(DONATION_LIST_LIMIT + 1);
  return {
    ok: true,
    limited: rows.length > DONATION_LIST_LIMIT,
    donations: rows.slice(0, DONATION_LIST_LIMIT).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      amountMinor: row.amountMinor,
      status: row.status,
      donorType: row.donorType,
      donorName: donorContact(ctx.cipher, row).name,
      organisationName: row.organisationName,
      receiptNumber: row.receiptNumber,
      guest: row.userId === null,
    })),
  };
}

export type DonationView = DonationListItem & {
  currency: string;
  donorEmail: string;
  discloseOrganisation: boolean;
  showOnWall: boolean;
  wallName: string | null;
  capturedAt: Date | null;
  expiresAt: Date | null;
  receipt: {
    number: string;
    issuedAt: Date;
    cancelledAt: Date | null;
  } | null;
  payment: {
    batchId: string;
    status: PaymentBatchStatus;
    gatewayPaymentId: string | null;
  } | null;
  offline: {
    method: OfflinePaymentMethod;
    reference: string;
    receivedOn: string;
    proofStatus: FileStatus;
  } | null;
  refunds: {
    id: string;
    kind: RefundKind;
    status: RefundStatus;
    amountMinor: bigint;
    requestedAt: Date;
  }[];
  reviewCases: {
    id: string;
    reason: PaymentReviewReason;
    outcome: PaymentReviewOutcome | null;
    openedAt: Date;
  }[];
  /** Whether requestDonationRefund may ask for what is left now. */
  canRequestRefund: boolean;
};

export type GetDonationInput = { donationId: string };

export type GetDonationResult =
  | { ok: true; donation: DonationView }
  | InvalidInput
  | { ok: false; error: "not_found" };

const donationInput = z.strictObject({ donationId: z.uuid() });

/** Refunds that still hold the donation's money, or already returned it. */
const LIVE_REFUND: readonly RefundStatus[] = [
  "requested",
  "approved",
  "processing",
  "failed",
];

export async function getDonation(
  ctx: UseCaseContext,
  input: GetDonationInput
): Promise<GetDonationResult> {
  await authorize(ctx, "donation.read");
  const parsed = donationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [row] = await ctx.db
    .select({
      id: donation.id,
      createdAt: donation.createdAt,
      amountMinor: donation.amountMinor,
      currency: donation.currency,
      status: donation.status,
      showOnWall: donation.showOnWall,
      wallName: donation.wallName,
      capturedAt: donation.capturedAt,
      offlineMethod: donation.offlineMethod,
      offlineReference: donation.offlineReference,
      offlineReceivedOn: donation.offlineReceivedOn,
      proofStatus: fileAsset.status,
      expiresAt: donation.expiresAt,
      donorType: donor.type,
      name: donor.name,
      email: donor.email,
      organisationName: donor.organisationName,
      discloseOrganisation: donor.discloseOrganisation,
      userId: donor.userId,
      receiptNumber: receipt.number,
      receiptIssuedAt: receipt.issuedAt,
      receiptCancelledAt: receipt.cancelledAt,
      batchId: paymentBatch.id,
      batchStatus: paymentBatch.status,
      gatewayPaymentId: paymentBatch.gatewayPaymentId,
    })
    .from(donation)
    .innerJoin(donor, eq(donor.id, donation.donorId))
    .leftJoin(receipt, eq(receipt.donationId, donation.id))
    .leftJoin(paymentBatch, eq(paymentBatch.id, donation.paymentBatchId))
    .leftJoin(fileAsset, eq(fileAsset.id, donation.offlineProofFileId))
    .where(eq(donation.id, parsed.data.donationId));
  if (!row) return { ok: false, error: "not_found" };

  const refunds = row.batchId
    ? await ctx.db
        .select({
          id: refund.id,
          kind: refund.kind,
          status: refund.status,
          amountMinor: refund.amountMinor,
          requestedAt: refund.requestedAt,
        })
        .from(refund)
        .where(eq(refund.batchId, row.batchId))
        .orderBy(desc(refund.requestedAt), desc(refund.id))
    : [];
  const reviewCases = row.batchId
    ? await ctx.db
        .select({
          id: paymentReviewCase.id,
          reason: paymentReviewCase.reason,
          outcome: paymentReviewCase.outcome,
          openedAt: paymentReviewCase.openedAt,
        })
        .from(paymentReviewCase)
        .where(eq(paymentReviewCase.batchId, row.batchId))
        .orderBy(desc(paymentReviewCase.openedAt))
    : [];
  const contact = donorContact(ctx.cipher, row);
  const ownRefunds = refunds.filter(
    (each) => each.kind === "discretionary" || each.kind === "cancellation"
  );
  return {
    ok: true,
    donation: {
      id: row.id,
      createdAt: row.createdAt,
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      donorType: row.donorType,
      donorName: contact.name,
      donorEmail: contact.email,
      organisationName: row.organisationName,
      discloseOrganisation: row.discloseOrganisation,
      showOnWall: row.showOnWall,
      wallName: row.wallName,
      capturedAt: row.capturedAt,
      expiresAt: row.expiresAt,
      guest: row.userId === null,
      receiptNumber: row.receiptNumber,
      receipt:
        row.receiptNumber && row.receiptIssuedAt
          ? {
              number: row.receiptNumber,
              issuedAt: row.receiptIssuedAt,
              cancelledAt: row.receiptCancelledAt,
            }
          : null,
      payment:
        row.batchId && row.batchStatus
          ? {
              batchId: row.batchId,
              status: row.batchStatus,
              gatewayPaymentId: row.gatewayPaymentId,
            }
          : null,
      offline:
        row.offlineMethod &&
        row.offlineReference &&
        row.offlineReceivedOn &&
        row.proofStatus
          ? {
              method: row.offlineMethod,
              reference: row.offlineReference,
              receivedOn: row.offlineReceivedOn,
              proofStatus: row.proofStatus,
            }
          : null,
      refunds,
      reviewCases,
      canRequestRefund:
        holdsMoney(row.status) &&
        row.gatewayPaymentId !== null &&
        !ownRefunds.some((each) => LIVE_REFUND.includes(each.status)),
    },
  };
}

export type RequestDonationRefundInput = { donationId: string; reason: string };

export type RequestDonationRefundResult =
  | { ok: true; refundId: string; amountMinor: bigint }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "not_refundable"
        | "refund_in_progress"
        | "reason_required"
        | "reason_too_long";
    };

const refundInput = z.strictObject({
  donationId: z.uuid(),
  reason: z.string().max(4000),
});

export async function requestDonationRefund(
  ctx: UseCaseContext,
  input: RequestDonationRefundInput
): Promise<RequestDonationRefundResult> {
  const { role } = await authorize(ctx, "donation.refund.request");
  const parsed = refundInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
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
  const [found] = await ctx.db
    .select({ batchId: donation.paymentBatchId })
    .from(donation)
    .where(eq(donation.id, parsed.data.donationId));
  if (!found?.batchId) return { ok: false, error: "not_found" };
  const batchId = found.batchId;

  return ctx.db.transaction(
    async (tx): Promise<RequestDonationRefundResult> => {
      // One request at a time per batch, as for fees.
      const batch = await lockBatch(tx, batchId);
      const [now] = await tx
        .select({ status: donation.status })
        .from(donation)
        .where(eq(donation.id, parsed.data.donationId))
        .for("update");
      if (!batch || !now) return { ok: false, error: "not_found" };
      if (
        !holdsMoney(now.status) ||
        batch.status !== "captured" ||
        batch.gatewayPaymentId === null
      ) {
        return { ok: false, error: "not_refundable" };
      }
      const available = await refundableBatch(tx, batch);
      if (available.kind === "dashboard") {
        return { ok: false, error: "not_refundable" };
      }
      const [live] = await tx
        .select({ id: refund.id })
        .from(refund)
        .where(
          and(
            eq(refund.batchId, batchId),
            eq(refund.gatewayPaymentId, batch.gatewayPaymentId)
          )
        )
        .limit(1)
        .for("update");
      const amountMinor = available.amountMinor - available.committedMinor;
      if (amountMinor <= 0n) {
        return {
          ok: false,
          error: live ? "refund_in_progress" : "not_refundable",
        };
      }
      const stamp = ctx.clock.now();
      const refundId = uuidv7(stamp);
      const status = initialRefundStatus("discretionary");
      await tx.insert(refund).values({
        id: refundId,
        batchId,
        gatewayPaymentId: batch.gatewayPaymentId,
        kind: "discretionary",
        status,
        method: "gateway",
        amountMinor,
        currency: "INR",
        reason: reason.text ?? "",
        requestedBy,
        requestedAt: stamp,
        updatedAt: stamp,
      });
      await auditRefund(
        tx,
        ctx,
        refundId,
        {
          action: "refund.requested",
          before: null,
          after: {
            batchId,
            donationId: parsed.data.donationId,
            kind: "discretionary",
            status,
            method: "gateway",
            amountMinor: amountMinor.toString(),
          },
        },
        role
      );
      return { ok: true, refundId, amountMinor };
    }
  );
}
