// Reads a Razorpay webhook (#77): the X-Razorpay-Signature over the raw
// body is checked first (./signature.ts), and only then is the body parsed
// for the event name and the order it is about (the payment's order_id, or
// the order's own id for order events). A refund event (refund.created,
// refund.processed, refund.failed: razorpay.com/docs/webhooks/refunds) also
// names the refund and the payment it returns (#80).
//
// The event's id, which the payments module dedupes webhooks on, is the
// SHA-256 of the signed body, not Razorpay's x-razorpay-event-id header:
// that header isn't covered by the signature, so a replayed body under a
// fresh header would otherwise count as a new event. A retry from Razorpay
// repeats the same body, so it is a duplicate too. Were a retry ever sent
// with a different body, it would only sync the batch again, which changes
// nothing once the batch is captured (src/server/modules/payments/sync-batch.ts).
//
// Loads under plain Node: relative imports only.

import { createHash } from "node:crypto";

import { z } from "zod";

import type { GatewayWebhook } from "../payment-gateway";
import { isValidWebhookSignature } from "./signature";

const SIGNATURE_HEADER = "x-razorpay-signature";

const entityWithId = z.object({ id: z.string().min(1) });

const eventBody = z.object({
  event: z.string().min(1),
  payload: z
    .object({
      payment: z
        .object({
          entity: z.object({ order_id: z.string().min(1).nullish() }),
        })
        .optional(),
      order: z.object({ entity: entityWithId }).optional(),
      subscription: z.object({ entity: entityWithId }).optional(),
      refund: z
        .object({
          entity: z.object({
            id: z.string().min(1),
            payment_id: z.string().min(1),
          }),
        })
        .optional(),
    })
    .optional(),
});

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

/**
 * The webhook's event, or null when its signature is missing or wrong, or
 * its signed body isn't a Razorpay event. Throws when `webhookSecret` is
 * empty, so a misconfiguration can't pass quietly.
 */
export function readRazorpayWebhook(
  rawBody: string,
  headers: Headers,
  webhookSecret: string
): GatewayWebhook | null {
  if (
    !isValidWebhookSignature(
      rawBody,
      headers.get(SIGNATURE_HEADER),
      webhookSecret
    )
  ) {
    return null;
  }
  const parsed = eventBody.safeParse(parseJson(rawBody));
  if (!parsed.success) return null;
  const { event, payload } = parsed.data;
  const refund = payload?.refund?.entity;
  return {
    eventId: createHash("sha256").update(rawBody).digest("hex"),
    type: event,
    orderId:
      payload?.payment?.entity.order_id ?? payload?.order?.entity.id ?? null,
    ...(payload?.subscription
      ? { subscriptionId: payload.subscription.entity.id }
      : {}),
    ...(refund
      ? { refund: { refundId: refund.id, paymentId: refund.payment_id } }
      : {}),
  };
}
