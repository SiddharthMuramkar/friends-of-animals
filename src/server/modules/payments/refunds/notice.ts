// What a refund's messages say (#80), read when the message goes: the
// competition, the amount in rupees and the reference the payer can quote
// to their bank (the gateway's refund id, or the transfer, cheque or cash
// receipt finance recorded). refund.processed tells whoever started the
// batch's payment (`subject_user`); refund.failed tells the finance team
// (`finance_team`), who may retry it.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import {
  competition,
  auctionOffer,
  paymentBatch,
  paymentReviewCase,
  refund,
  userRole,
} from "../../../db/schema";
import { createTranslator } from "next-intl";

import donationsMessages from "../../../../../messages/en-IN/donations.json";
import { formatCapturedAmount, formatPaise } from "../domain/money-format";

const forDonation = createTranslator({
  locale: "en-IN",
  messages: donationsMessages,
  namespace: "donations.refundNotice",
});

/** The variables a refund template may use, beyond the recipient's. */
export const REFUND_VARIABLES = [
  "competition.name",
  "refund.amount",
  "refund.reference",
] as const;

export async function refundValues(
  db: AppDb,
  refundId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      amountMinor: refund.amountMinor,
      gatewayRefundId: refund.gatewayRefundId,
      manualReference: refund.manualReference,
      competitionName: competition.name,
      lotCode: auctionOffer.lotCode,
    })
    .from(refund)
    .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
    // A donation's batch (#106) has no competition: finance's alert of a
    // failed refund says it was a donation.
    .leftJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(auctionOffer, eq(auctionOffer.batchId, paymentBatch.id))
    .where(eq(refund.id, refundId));
  if (!row) return {};
  return {
    "competition.name":
      row.lotCode ?? row.competitionName ?? forDonation("subjectName"),
    "refund.amount": formatPaise(row.amountMinor),
    "refund.reference": row.gatewayRefundId ?? row.manualReference ?? "",
  };
}

export async function dashboardRefundValues(
  db: AppDb,
  caseId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      amountMinor: paymentReviewCase.amountMinor,
      currency: paymentReviewCase.currency,
      reference: paymentReviewCase.dashboardRefundReference,
      competitionName: competition.name,
    })
    .from(paymentReviewCase)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentReviewCase.batchId))
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .where(eq(paymentReviewCase.id, caseId));
  if (!row?.reference) return {};
  return {
    "competition.name": row.competitionName,
    "refund.amount": formatCapturedAmount(row.amountMinor, row.currency),
    "refund.reference": row.reference,
  };
}

/** Every user holding the finance role. */
export async function financeTeam(db: AppDb): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: userRole.userId })
    .from(userRole)
    .where(and(eq(userRole.role, "finance"), eq(userRole.scopeType, "global")))
    .orderBy(asc(userRole.userId));
  return rows.map((row) => row.userId);
}
