// The Razorpay adapter of the payment-gateway port (#77), over `fetch`
// with no SDK: two endpoints and two HMAC checks don't justify one.
//   - createOrder: POST /v1/orders, Basic auth with the key pair, the amount
//     as whole paise (a JSON number, so at most 2^53 - 1), INR, the batch
//     id as receipt.
//   - fetchOrderPayments: GET /v1/orders/{id}/payments, each attempt's
//     status, amount (bigint paise) and currency.
//   - refund (#80): POST /v1/payments/{id}/refund at normal speed with the
//     amount in whole paise and our notes, and the idempotency key in
//     X-Refund-Idempotency, so a retry after a lost answer returns the
//     refund the first call made.
//   - fetchRefunds: GET /v1/payments/{id}/refunds (up to 100: a payment of
//     ours is refunded a handful of times at most).
//   - verifyCheckout and readWebhook: ./signature.ts and ./webhook.ts.
// The key id's prefix says which mode it is: rzp_live_ is "razorpay",
// rzp_test_ "razorpay-test". Which keys an environment may use is decided
// in ../payment-gateway-select.ts.
// Errors name Razorpay's HTTP status and error code, never the request,
// so no credential reaches a log.
// Sources: razorpay.com/docs/api/orders/create,
// razorpay.com/docs/api/orders/fetch-payments,
// razorpay.com/docs/api/refunds/create-normal (and its idempotent request)
// and razorpay.com/docs/api/refunds/fetch-multiple-refund-payment.
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

import {
  RefundRefusedError,
  type CheckoutParams,
  type GatewayPayment,
  type GatewayRefund,
  type GatewayWebhook,
  type Money,
  type PaymentGateway,
} from "../payment-gateway";
import { isValidCheckoutSignature } from "./signature";
import { readRazorpayWebhook } from "./webhook";

export type RazorpayKeys = {
  /** rzp_test_… or rzp_live_…; public, Checkout takes it. */
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

const API = "https://api.razorpay.com/v1";

/** How long one call to Razorpay may take before it counts as failed. */
const TIMEOUT_MS = 15_000;

/** Thrown when Razorpay refuses a call or answers in a way we can't read. */
export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly refundRefusal: RefundRefusedError["reason"] | null = null
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

// Documented refusals for the same refund request. Other 400s can mean
// the payment is busy or the refund already exists. Recover with the
// same key and look up the original attempt.
const FULL_REFUND_ONLY =
  "partial refund is currently not supported for this payment method";
const DEFINITIVE_REFUND_REFUSALS = new Set([
  "the refund amount provided is greater than amount captured",
  "the amount must be at least inr 1.00",
  "refund is currently not supported for this payment method",
  FULL_REFUND_ONLY,
]);

const orderCreated = z.object({ id: z.string().min(1) });

const paymentEntity = z.object({
  id: z.string().min(1),
  order_id: z.string().min(1),
  status: z.enum(["created", "authorized", "captured", "failed", "refunded"]),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
});

const paymentCollection = z.object({ items: z.array(paymentEntity) });

const refundEntity = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  status: z.enum(["pending", "processed", "failed"]),
  // Razorpay sends an empty list for a refund made without notes.
  notes: z
    .union([z.record(z.string(), z.string()), z.array(z.never())])
    .optional(),
});

const refundCollection = z.object({ items: z.array(refundEntity) });

function refundFrom(entity: z.infer<typeof refundEntity>): GatewayRefund {
  return {
    id: entity.id,
    paymentId: entity.payment_id,
    amountMinor: BigInt(entity.amount),
    currency: entity.currency,
    status: entity.status,
    notes: Array.isArray(entity.notes) ? {} : { ...entity.notes },
  };
}

const errorBody = z.object({
  error: z
    .object({ code: z.string().optional(), description: z.string().nullish() })
    .optional(),
});

function modeOf(keyId: string): "razorpay" | "razorpay-test" {
  if (keyId.startsWith("rzp_live_")) return "razorpay";
  if (keyId.startsWith("rzp_test_")) return "razorpay-test";
  throw new TypeError("A Razorpay key id starts with rzp_test_ or rzp_live_");
}

/** Paise as Razorpay's JSON takes them: a whole number, exactly. */
function paiseForJson(amount: Money): number {
  if (amount.amountMinor <= 0n) {
    throw new RangeError("A Razorpay amount must be more than nothing");
  }
  if (amount.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("The amount is too large to send to Razorpay");
  }
  return Number(amount.amountMinor);
}

export function razorpayGateway({
  keyId,
  keySecret,
  webhookSecret,
  fetch: fetchImpl = fetch,
}: RazorpayKeys & { fetch?: typeof fetch }): PaymentGateway {
  const name = modeOf(keyId);
  if (keySecret === "" || webhookSecret === "") {
    throw new TypeError("Razorpay needs its key secret and webhook secret");
  }
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<unknown> {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const error = errorBody.safeParse(parsed).data?.error;
      const code = error?.code;
      const description = error?.description
        ?.trim()
        .replace(/\.$/, "")
        .toLowerCase();
      const refused =
        response.status === 400 &&
        code === "BAD_REQUEST_ERROR" &&
        DEFINITIVE_REFUND_REFUSALS.has(description ?? "");
      throw new RazorpayError(
        `Razorpay answered ${method} ${path.split("/")[1]} with HTTP ${response.status}`,
        refused
          ? description === FULL_REFUND_ONLY
            ? "full_refund_only"
            : "definitive"
          : null
      );
    }
    return parsed;
  }

  return {
    name,

    async createOrder({ amount, receipt, notes }) {
      const paise = paiseForJson(amount);
      const answer = orderCreated.safeParse(
        await call("POST", "/orders", {
          amount: paise,
          currency: amount.currency,
          receipt,
          notes,
        })
      );
      if (!answer.success) {
        throw new RazorpayError("Razorpay's order answer has no order id");
      }
      return { orderId: answer.data.id };
    },

    checkout({ orderId, amount, description }): CheckoutParams {
      return { gateway: name, orderId, amount, description, publicKey: keyId };
    },

    verifyCheckout(returned) {
      return isValidCheckoutSignature(returned, keySecret);
    },

    readWebhook(rawBody, headers): GatewayWebhook | null {
      return readRazorpayWebhook(rawBody, headers, webhookSecret);
    },

    async fetchOrderPayments(orderId): Promise<GatewayPayment[]> {
      const answer = paymentCollection.safeParse(
        await call("GET", `/orders/${encodeURIComponent(orderId)}/payments`)
      );
      if (!answer.success) {
        throw new RazorpayError("Razorpay's payments answer can't be read");
      }
      return answer.data.items.map((payment) => ({
        id: payment.id,
        orderId: payment.order_id,
        status: payment.status,
        amountMinor: BigInt(payment.amount),
        currency: payment.currency,
      }));
    },

    async refund({ paymentId, amount, idempotencyKey, notes }) {
      const paise = paiseForJson(amount);
      let answered: unknown;
      try {
        answered = await call(
          "POST",
          `/payments/${encodeURIComponent(paymentId)}/refund`,
          {
            amount: paise,
            speed: "normal",
            ...(Object.keys(notes).length > 0 ? { notes } : {}),
          },
          { "x-refund-idempotency": idempotencyKey }
        );
      } catch (error) {
        if (error instanceof RazorpayError && error.refundRefusal) {
          throw new RefundRefusedError(error.message, error.refundRefusal);
        }
        throw error;
      }
      const answer = refundEntity.safeParse(answered);
      if (!answer.success) {
        throw new RazorpayError("Razorpay's refund answer can't be read");
      }
      return refundFrom(answer.data);
    },

    async fetchRefunds(paymentId): Promise<GatewayRefund[]> {
      const answer = refundCollection.safeParse(
        await call(
          "GET",
          `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`
        )
      );
      if (!answer.success) {
        throw new RazorpayError("Razorpay's refunds answer can't be read");
      }
      return answer.data.items.map(refundFrom);
    },
  };
}
