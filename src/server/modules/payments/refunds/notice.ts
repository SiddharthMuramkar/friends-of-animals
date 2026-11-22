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
import { competition, paymentBatch, refund, userRole } from "../../../db/schema";
import { formatPaise } from "../domain/money-format";

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
    })
    .from(refund)
    .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
    .innerJoin(competition, eq(competition.id, paymentBatch.competitionId))
    .where(eq(refund.id, refundId));
  if (!row) return {};
  return {
    "competition.name": row.competitionName,
    "refund.amount": formatPaise(row.amountMinor),
    "refund.reference": row.gatewayRefundId ?? row.manualReference ?? "",
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
