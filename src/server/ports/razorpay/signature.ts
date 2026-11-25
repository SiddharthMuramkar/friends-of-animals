// Razorpay's two signatures (#77), checked as Razorpay's docs define them:
//   - Checkout return: hex HMAC-SHA256 of `${orderId}|${paymentId}` under the
//     key secret. The order id must be the one stored with the batch, never
//     the one the browser sent back.
//   - Webhook: hex HMAC-SHA256 of the raw request body under the webhook
//     secret, sent in the X-Razorpay-Signature header. Never parse or
//     re-serialise the body before checking it.
// Comparison is constant-time. A missing secret throws: a forgeable check
// must never pass quietly.
// Sources: razorpay.com/docs/payments/server-integration/nodejs/integration-steps
// and razorpay.com/docs/webhooks/validate-test.

import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

function hmacHex(secret: string, message: string, what: string): string {
  if (secret === "") {
    throw new TypeError(`The Razorpay ${what} is empty`);
  }
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sameHex(expected: string, received: string | null): boolean {
  if (received === null || !HEX_SHA256.test(received)) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex")
  );
}

/** Whether Checkout's `razorpay_signature` is genuine for this order. */
export function isValidCheckoutSignature(
  returned: { orderId: string; paymentId: string; signature: string },
  keySecret: string
): boolean {
  const expected = hmacHex(
    keySecret,
    `${returned.orderId}|${returned.paymentId}`,
    "key secret"
  );
  return sameHex(expected, returned.signature);
}

/** Whether a webhook's X-Razorpay-Signature matches its raw body. */
export function isValidWebhookSignature(
  rawBody: string,
  signature: string | null,
  webhookSecret: string
): boolean {
  return sameHex(hmacHex(webhookSecret, rawBody, "webhook secret"), signature);
}

/** Subscriptions sign payment id first, then the stored subscription id. */
export function isValidSubscriptionCheckoutSignature(
  returned: { subscriptionId: string; paymentId: string; signature: string },
  keySecret: string
): boolean {
  return sameHex(
    hmacHex(
      keySecret,
      `${returned.paymentId}|${returned.subscriptionId}`,
      "key secret"
    ),
    returned.signature
  );
}
