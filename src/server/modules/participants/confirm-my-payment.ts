// confirmMyPayment({ registrationId, paymentId, signature }) (#78): what an
// adult's browser posts back after the gateway's Checkout for their own
// registration (the island arrives with 77b). The signature is checked
// against the order stored with the batch that holds the registration,
// never one the browser sends. A genuine one is still only a hint: the
// batch is synced against the gateway's record (../payments/sync-batch.ts),
// like a webhook, so the two confirm once between them.

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { paymentBatch, paymentBatchItem } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import type { SyncOutcome } from "../payments/domain/outcomes";
import { syncBatch } from "../payments/sync-batch";
import { authorizeOwner } from "./pay-for-my-registration";

export type ConfirmMyPaymentInput = {
  registrationId: string;
  paymentId: string;
  signature: string;
};

export type ConfirmMyPaymentResult =
  | { ok: true; outcome: SyncOutcome }
  | InvalidInput
  | { ok: false; error: "not_found" | "invalid_signature" };

const confirmInput = z.object({
  registrationId: z.uuid(),
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});

export async function confirmMyPayment(
  ctx: UseCaseContext,
  input: ConfirmMyPaymentInput
): Promise<ConfirmMyPaymentResult> {
  const parsed = confirmInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId, paymentId, signature } = parsed.data;
  const role = await authorizeOwner(ctx, registrationId);

  // The batch that holds the registration now, with its order.
  const [batch] = await ctx.db
    .select({
      id: paymentBatch.id,
      gateway: paymentBatch.gateway,
      orderId: paymentBatch.gatewayOrderId,
    })
    .from(paymentBatchItem)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentBatchItem.batchId))
    .where(
      and(
        eq(paymentBatchItem.registrationId, registrationId),
        isNull(paymentBatchItem.releasedAt)
      )
    )
    .orderBy(desc(paymentBatch.createdAt))
    .limit(1);
  if (!batch) return { ok: false, error: "not_found" };
  const genuine =
    batch.orderId !== null &&
    batch.gateway === ctx.payments.name &&
    ctx.payments.verifyCheckout({
      orderId: batch.orderId,
      paymentId,
      signature,
    });
  if (!genuine) return { ok: false, error: "invalid_signature" };

  return { ok: true, outcome: await syncBatch(ctx, batch.id, role) };
}
