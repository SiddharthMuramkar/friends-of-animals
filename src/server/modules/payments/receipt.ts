// What the payment receipt (#77) says, read when the message goes: the
// competition, the institution, its registration's reference, the amount
// in rupees, how many students it paid for and the gateway's payment id,
// or for a batch paid offline (#79), the cheque, transfer or receipt
// reference finance recorded.
// The receipt goes by #69's route rows to whoever started the payment
// (`subject_user`, from payment.batch_captured's payerUserId). It is not a
// numbered tax receipt: FY-sequential receipt numbers belong to donations
// (#106).
//
// An adult paying for their own registration (#78) gets a receipt of their
// own (`individual_payer`, template payment.receipt_individual), with the
// registration number and their FOA Participant ID in place of the
// institution's details.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, isNull } from "drizzle-orm";
import { createTranslator } from "next-intl";

import paymentMessages from "../../../../messages/en-IN/payments.json";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  institution,
  institutionRegistration,
  offlinePayment,
  participantProfile,
  paymentBatch,
  paymentBatchItem,
  registration,
} from "../../db/schema";
import type { ParticipationRoute } from "../competitions/domain/fees";
import { formatPaise } from "./domain/money-format";

/** The variables a receipt template may use, beyond the recipient's. */
export const RECEIPT_VARIABLES = [
  "competition.name",
  "institution.name",
  "registration.reference",
  "payment.amount",
  "payment.students",
  "payment.reference",
  // An adult's own payment (#78).
  "registration.number",
  "participant.code",
] as const;

const t = createTranslator({
  locale: "en-IN",
  messages: paymentMessages,
  namespace: "payments.order",
});

export async function receiptValues(
  db: AppDb,
  batchId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      route: paymentBatch.route,
      amountMinor: paymentBatch.amountMinor,
      gatewayPaymentId: paymentBatch.gatewayPaymentId,
      offlineReference: offlinePayment.reference,
      competitionName: competition.name,
      institutionName: institution.name,
      reference: institutionRegistration.reference,
    })
    .from(paymentBatch)
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .leftJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, paymentBatch.institutionRegistrationId)
    )
    .leftJoin(offlinePayment, eq(offlinePayment.batchId, paymentBatch.id))
    .where(eq(paymentBatch.id, batchId));
  if (!row) return {};
  const held = await db
    .select({
      registrationNumber: registration.registrationNumber,
      participantCode: participantProfile.participantCode,
    })
    .from(paymentBatchItem)
    .innerJoin(
      registration,
      eq(registration.id, paymentBatchItem.registrationId)
    )
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(paymentBatchItem.batchId, batchId),
        isNull(paymentBatchItem.releasedAt)
      )
    );
  const own = row.route === "individual" ? held[0] : undefined;
  return {
    "competition.name": row.competitionName,
    "institution.name": row.institutionName ?? "",
    "registration.reference": row.reference ?? "",
    "payment.amount": formatPaise(row.amountMinor),
    "payment.students": t("studentCount", { count: held.length }),
    "payment.reference": row.gatewayPaymentId ?? row.offlineReference ?? "",
    "registration.number": own?.registrationNumber ?? "",
    "participant.code": own?.participantCode ?? "",
  };
}

/**
 * Who paid batch `batchId`, if it was paid on `route`: the institution's
 * receipt and an adult's own go to the payer by different routes.
 */
export async function payerOn(
  db: AppDb,
  batchId: string,
  route: ParticipationRoute
): Promise<string[]> {
  const [row] = await db
    .select({ payerUserId: paymentBatch.payerUserId })
    .from(paymentBatch)
    .where(and(eq(paymentBatch.id, batchId), eq(paymentBatch.route, route)));
  return row?.payerUserId ? [row.payerUserId] : [];
}
