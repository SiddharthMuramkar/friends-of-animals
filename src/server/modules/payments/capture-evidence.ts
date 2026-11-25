import { createHash } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { gatewayWebhookEvent, type PaymentBatchRow } from "../../db/schema";

export function captureFingerprint(paymentId: string) {
  return createHash("sha256").update(paymentId).digest("hex");
}

/** Only exact positive evidence from the order's own signed captured event
 * can establish timely capture after the fact. Provider creation/receipt
 * instants or an event after the deadline do not establish capture time. */
export async function timelyCaptureEvidence(
  db: AppDb,
  batch: PaymentBatchRow,
  paymentId: string,
  offeredAt: Date,
  expiresAt: Date
) {
  if (!batch.gatewayOrderId) return false;
  const [event] = await db
    .select({ id: gatewayWebhookEvent.id })
    .from(gatewayWebhookEvent)
    .where(
      and(
        eq(gatewayWebhookEvent.gateway, batch.gateway),
        eq(gatewayWebhookEvent.orderId, batch.gatewayOrderId),
        eq(gatewayWebhookEvent.type, "payment.captured"),
        eq(
          gatewayWebhookEvent.capturePaymentFingerprint,
          captureFingerprint(paymentId)
        ),
        gte(gatewayWebhookEvent.captureOccurredBy, offeredAt),
        lt(gatewayWebhookEvent.captureOccurredBy, expiresAt)
      )
    )
    .limit(1);
  return !!event;
}

/** A new signed capture signal received during the network read may make
 * that snapshot stale. Compare event ids and refetch before fallback. */
export async function captureSignalIds(
  db: AppDb,
  batch: Pick<PaymentBatchRow, "gateway" | "gatewayOrderId">
) {
  if (!batch.gatewayOrderId) return [];
  const rows = await db
    .select({ id: gatewayWebhookEvent.id })
    .from(gatewayWebhookEvent)
    .where(
      and(
        eq(gatewayWebhookEvent.gateway, batch.gateway),
        eq(gatewayWebhookEvent.orderId, batch.gatewayOrderId),
        eq(gatewayWebhookEvent.type, "payment.captured")
      )
    );
  return rows.map((row) => row.id);
}
