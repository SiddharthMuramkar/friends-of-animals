// The fallback gateway's test checkout, answered for one order (#77): the
// tester pays it in full or declines. Shared by the school's pay page
// (./pay-test-checkout.ts) and an adult's (../participants/
// pay-my-test-checkout.ts), which each find the order stored with their
// batch first, never one the browser names.

import type { FallbackPaymentGateway } from "../../ports/payment-gateway-fallback";

export type TestCheckoutAnswer =
  /** What Razorpay's Checkout would hand back: post it to confirm. */
  | { ok: true; outcome: "paid"; paymentId: string; signature: string }
  | { ok: true; outcome: "declined" }
  | { ok: false; error: "not_found" };

export async function answerTestCheckout(
  gateway: FallbackPaymentGateway,
  orderId: string,
  outcome: "pay" | "decline"
): Promise<TestCheckoutAnswer> {
  if (outcome === "decline") {
    const declined = await gateway.decline(orderId);
    return declined
      ? { ok: true, outcome: "declined" }
      : { ok: false, error: "not_found" };
  }
  const paid = await gateway.capture(orderId);
  return paid
    ? { ok: true, outcome: "paid", ...paid }
    : { ok: false, error: "not_found" };
}
