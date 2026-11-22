// payTestCheckout({ institutionId, batchId, outcome }) (#77): the fallback
// gateway's test checkout, where a tester pays or declines a batch's order
// in place of Razorpay's Checkout. It works only where the fallback is the
// gateway (never production: ../../ports/payment-gateway-select.ts), and
// only on an open batch of an institution the actor pays for. The order is
// the one stored with the batch, never one the browser names. Paying hands
// back what Razorpay's Checkout would (a payment id and its signature),
// which the browser then posts to confirmCheckout like any Checkout return.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { paymentBatch } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { isFallbackGateway } from "../../ports/payment-gateway-fallback";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";

export type PayTestCheckoutInput = {
  institutionId: string;
  batchId: string;
  outcome: "pay" | "decline";
};

export type PayTestCheckoutResult =
  | { ok: true; outcome: "paid"; paymentId: string; signature: string }
  | { ok: true; outcome: "declined" }
  | InvalidInput
  | { ok: false; error: "not_found" | "unavailable" };

const testCheckoutInput = z.object({
  institutionId: z.uuid(),
  batchId: z.uuid(),
  outcome: z.enum(["pay", "decline"]),
});

export async function payTestCheckout(
  ctx: UseCaseContext,
  input: PayTestCheckoutInput
): Promise<PayTestCheckoutResult> {
  const parsed = testCheckoutInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, batchId, outcome } = parsed.data;
  await authorize(ctx, "payments.pay", institutionResource(institutionId));

  const gateway = ctx.payments;
  if (!isFallbackGateway(gateway)) return { ok: false, error: "unavailable" };

  const [batch] = await ctx.db
    .select({ orderId: paymentBatch.gatewayOrderId })
    .from(paymentBatch)
    .where(
      and(
        eq(paymentBatch.id, batchId),
        eq(paymentBatch.institutionId, institutionId),
        eq(paymentBatch.status, "order_created"),
        eq(paymentBatch.gateway, gateway.name)
      )
    );
  if (!batch?.orderId) return { ok: false, error: "not_found" };

  if (outcome === "decline") {
    const declined = await gateway.decline(batch.orderId);
    return declined
      ? { ok: true, outcome: "declined" }
      : { ok: false, error: "not_found" };
  }
  const paid = await gateway.capture(batch.orderId);
  return paid
    ? { ok: true, outcome: "paid", ...paid }
    : { ok: false, error: "not_found" };
}
