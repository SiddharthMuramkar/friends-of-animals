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
  created_at: z.unknown().optional(),
  payload: z
    .object({
      payment: z
        .object({
          entity: z.object({
            order_id: z.string().min(1).nullish(),
            id: z.unknown().optional(),
            status: z.unknown().optional(),
            captured: z.unknown().optional(),
          }),
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
  const payment = payload?.payment?.entity;
  const eventAt = parsed.data.created_at;
  // Razorpay gives event snapshots (not payment entity creation time).
  // The top-level timestamp has one-second precision, so its last possible
  // millisecond is the conservative upper bound. Missing or invalid fields
  // still allow ordinary provider reconciliation, but give no timing proof.
  const capture =
    event === "payment.captured" &&
    payment?.order_id &&
    typeof payment.id === "string" &&
    payment.id.length > 0 &&
    payment.status === "captured" &&
    payment.captured === true &&
    typeof eventAt === "number" &&
    Number.isSafeInteger(eventAt) &&
    eventAt > 0 &&
    eventAt < 8_640_000_000_000
      ? { paymentId: payment.id, occurredBy: new Date(eventAt * 1000 + 999) }
      : undefined;
  return {
    eventId: createHash("sha256").update(rawBody).digest("hex"),
    type: event,
    orderId:
      payload?.payment?.entity.order_id ?? payload?.order?.entity.id ?? null,
    ...(payload?.subscription
      ? { subscriptionId: payload.subscription.entity.id }
      : {}),
    ...(capture ? { capture } : {}),
    ...(refund
      ? { refund: { refundId: refund.id, paymentId: refund.payment_id } }
      : {}),
  };
}
