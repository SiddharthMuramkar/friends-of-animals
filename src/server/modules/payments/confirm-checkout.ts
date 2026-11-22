// confirmCheckout({ institutionId, batchId, paymentId, signature }) (#77):
// what the coordinator's browser posts back after the gateway's Checkout.
// The signature is checked against the order id stored with the batch,
// never one the browser sends, so it proves this payment was made on this
// batch's order. A signature that isn't genuine is refused and changes
// nothing. A genuine one is still only a hint: the batch is synced against
// the gateway's record (./sync-batch.ts), like a webhook, so the two
// confirm once between them, in whichever order they arrive.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { paymentBatch } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import type { SyncOutcome } from "./domain/outcomes";
import { syncBatch } from "./sync-batch";

export type ConfirmCheckoutInput = {
  institutionId: string;
  batchId: string;
  paymentId: string;
  signature: string;
};

export type ConfirmCheckoutResult =
  | { ok: true; outcome: SyncOutcome }
  | InvalidInput
  | { ok: false; error: "not_found" | "invalid_signature" };

const confirmInput = z.object({
  institutionId: z.uuid(),
  batchId: z.uuid(),
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});

export async function confirmCheckout(
  ctx: UseCaseContext,
  input: ConfirmCheckoutInput
): Promise<ConfirmCheckoutResult> {
  const parsed = confirmInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, batchId, paymentId, signature } = parsed.data;
  const { role } = await authorize(
    ctx,
    "payments.pay",
    institutionResource(institutionId)
  );

  const [batch] = await ctx.db
    .select({
      gateway: paymentBatch.gateway,
      orderId: paymentBatch.gatewayOrderId,
    })
    .from(paymentBatch)
    .where(
      and(
        eq(paymentBatch.id, batchId),
        eq(paymentBatch.institutionId, institutionId)
      )
    );
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

  return { ok: true, outcome: await syncBatch(ctx, batchId, role) };
}
