// payMyTestCheckout({ registrationId, outcome }) (#77, 77c): the fallback
// gateway's test checkout on an adult's own pay page (#78), where a tester
// pays or declines the order in place of Razorpay's Checkout, as a school
// does on its pay page (../payments/pay-test-checkout.ts). It works only
// where the fallback is the gateway (never production:
// ../../ports/payment-gateway-select.ts), only for the registration's
// owner, and only on the order of the open batch that holds the
// registration now. Paying hands back what Razorpay's Checkout would, which
// the browser then posts to confirmMyPayment like any Checkout return.

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { paymentBatch, paymentBatchItem } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { isFallbackGateway } from "../../ports/payment-gateway-fallback";
import type { UseCaseContext } from "../../use-cases";
import {
  answerTestCheckout,
  type TestCheckoutAnswer,
} from "../payments/test-checkout";
import { authorizeOwner } from "./pay-for-my-registration";

export type PayMyTestCheckoutInput = {
  registrationId: string;
  outcome: "pay" | "decline";
};

export type PayMyTestCheckoutResult =
  | TestCheckoutAnswer
  | InvalidInput
  | { ok: false; error: "unavailable" };

const testCheckoutInput = z.object({
  registrationId: z.uuid(),
  outcome: z.enum(["pay", "decline"]),
});

export async function payMyTestCheckout(
  ctx: UseCaseContext,
  input: PayMyTestCheckoutInput
): Promise<PayMyTestCheckoutResult> {
  const parsed = testCheckoutInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId, outcome } = parsed.data;
  await authorizeOwner(ctx, registrationId);

  const gateway = ctx.payments;
  if (!isFallbackGateway(gateway)) return { ok: false, error: "unavailable" };

  const [batch] = await ctx.db
    .select({ orderId: paymentBatch.gatewayOrderId })
    .from(paymentBatchItem)
    .innerJoin(paymentBatch, eq(paymentBatch.id, paymentBatchItem.batchId))
    .where(
      and(
        eq(paymentBatchItem.registrationId, registrationId),
        isNull(paymentBatchItem.releasedAt),
        eq(paymentBatch.status, "order_created"),
        eq(paymentBatch.gateway, gateway.name)
      )
    )
    .orderBy(desc(paymentBatch.createdAt))
    .limit(1);
  if (!batch?.orderId) return { ok: false, error: "not_found" };

  return answerTestCheckout(gateway, batch.orderId, outcome);
}
