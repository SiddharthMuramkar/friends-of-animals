// What the payment receipt (#77) says, read when the message goes: the
// competition, the institution, its registration's reference, the amount
// in rupees, how many students it paid for and the gateway's payment id.
// The receipt goes by #69's route rows to whoever started the payment
// (`subject_user`, from payment.batch_captured's payerUserId). It is not a
// numbered tax receipt: FY-sequential receipt numbers belong to donations
// (#106).
//
// Loads under plain Node (the worker): relative imports only.

import { and, count, eq, isNull } from "drizzle-orm";
import { createTranslator } from "next-intl";

import paymentMessages from "../../../../messages/en-IN/payments.json";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  institution,
  institutionRegistration,
  paymentBatch,
  paymentBatchItem,
} from "../../db/schema";
import { formatPaise } from "./domain/money-format";

/** The variables a receipt template may use, beyond the recipient's. */
export const RECEIPT_VARIABLES = [
  "competition.name",
  "institution.name",
  "registration.reference",
  "payment.amount",
  "payment.students",
  "payment.reference",
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
      amountMinor: paymentBatch.amountMinor,
      gatewayPaymentId: paymentBatch.gatewayPaymentId,
      competitionName: competition.name,
      institutionName: institution.name,
      reference: institutionRegistration.reference,
    })
    .from(paymentBatch)
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .innerJoin(institution, eq(institution.id, paymentBatch.institutionId))
    .innerJoin(
      institutionRegistration,
      eq(institutionRegistration.id, paymentBatch.institutionRegistrationId)
    )
    .where(eq(paymentBatch.id, batchId));
  if (!row) return {};
  const [held] = await db
    .select({ students: count() })
    .from(paymentBatchItem)
    .where(
      and(
        eq(paymentBatchItem.batchId, batchId),
        isNull(paymentBatchItem.releasedAt)
      )
    );
  return {
    "competition.name": row.competitionName,
    "institution.name": row.institutionName,
    "registration.reference": row.reference,
    "payment.amount": formatPaise(row.amountMinor),
    "payment.students": t("studentCount", { count: held?.students ?? 0 }),
    "payment.reference": row.gatewayPaymentId ?? "",
  };
}
