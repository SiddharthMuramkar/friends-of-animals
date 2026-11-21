// Test helpers that build webhooks the way Razorpay delivers them: the
// documented event envelope, the raw body signed with HMAC-SHA256 under the
// webhook secret in X-Razorpay-Signature, and the event id in
// x-razorpay-event-id. Tests only: nothing in the app imports this file.
//
// They also give 77a's paymentGatewayContract its `webhook()` setup, for
// both the Razorpay adapter (its webhook secret) and the fallback adapter
// (its fixed key).

import { createHmac } from "node:crypto";

/** What a simulated event is about. */
export type SimulatedEvent = {
  /** For example "payment.captured", "payment.failed" or "order.paid". */
  type: string;
  orderId: string;
  paymentId?: string;
  amountMinor?: bigint;
};

let sequence = 0;

/** The event body Razorpay sends, shaped like its documented examples. */
export function razorpayEventBody(event: SimulatedEvent): string {
  const amount = Number(event.amountMinor ?? 50_000n);
  const payment = {
    id: event.paymentId ?? "pay_TestPayment001",
    entity: "payment",
    amount,
    currency: "INR",
    status: event.type === "payment.failed" ? "failed" : "captured",
    order_id: event.orderId,
    method: "upi",
    captured: event.type !== "payment.failed",
    created_at: 1_798_000_000,
  };
  const order = {
    id: event.orderId,
    entity: "order",
    amount,
    amount_paid: amount,
    amount_due: 0,
    currency: "INR",
    status: "paid",
  };
  const payload =
    event.type === "order.paid"
      ? { payment: { entity: payment }, order: { entity: order } }
      : { payment: { entity: payment } };
  return JSON.stringify({
    entity: "event",
    account_id: "acc_TestAccount01",
    event: event.type,
    contains: Object.keys(payload),
    payload,
    created_at: 1_798_000_005,
  });
}

/** Hex HMAC-SHA256 of `rawBody` under `secret`, as Razorpay signs it. */
export function signRazorpayBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * A webhook as Razorpay delivers it. `signature: "invalid"` signs the
 * body with another secret, as a forger who lacks ours would.
 */
export function razorpayWebhook(
  event: SimulatedEvent,
  {
    secret,
    signature = "valid",
    eventId,
  }: {
    secret: string;
    signature?: "valid" | "invalid";
    eventId?: string;
  }
): { rawBody: string; headers: Headers } {
  sequence += 1;
  const rawBody = razorpayEventBody(event);
  const key = signature === "valid" ? secret : `not-${secret}`;
  return {
    rawBody,
    headers: new Headers({
      "content-type": "application/json",
      "x-razorpay-signature": signRazorpayBody(rawBody, key),
      "x-razorpay-event-id": eventId ?? `evt_Simulated${sequence}`,
    }),
  };
}
