// The Razorpay adapter of the payment-gateway port (#77), over `fetch`
// with no SDK: two endpoints and two HMAC checks don't justify one.
//   - createOrder: POST /v1/orders, Basic auth with the key pair, the amount
//     as whole paise (a JSON number, so at most 2^53 - 1), INR, the batch
//     id as receipt.
//   - fetchOrderPayments: GET /v1/orders/{id}/payments, each attempt's
//     status, amount (bigint paise) and currency.
//   - verifyCheckout and readWebhook: ./signature.ts and ./webhook.ts.
// The key id's prefix says which mode it is: rzp_live_ is "razorpay",
// rzp_test_ "razorpay-test". Which keys an environment may use is decided
// in ../payment-gateway-select.ts.
// Errors name Razorpay's HTTP status and error code, never the request,
// so no credential reaches a log.
// Sources: razorpay.com/docs/api/orders/create and
// razorpay.com/docs/api/orders/fetch-payments.
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

import type {
  CheckoutParams,
  GatewayPayment,
  GatewayWebhook,
  Money,
  PaymentGateway,
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
  constructor(message: string) {
    super(message);
    this.name = "RazorpayError";
  }
}

const orderCreated = z.object({ id: z.string().min(1) });

const paymentEntity = z.object({
  id: z.string().min(1),
  order_id: z.string().min(1),
  status: z.enum(["created", "authorized", "captured", "failed", "refunded"]),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
});

const paymentCollection = z.object({ items: z.array(paymentEntity) });

const errorBody = z.object({
  error: z.object({ code: z.string().optional() }).optional(),
});

function modeOf(keyId: string): "razorpay" | "razorpay-test" {
  if (keyId.startsWith("rzp_live_")) return "razorpay";
  if (keyId.startsWith("rzp_test_")) return "razorpay-test";
  throw new TypeError("A Razorpay key id starts with rzp_test_ or rzp_live_");
}

/** Paise as Razorpay's JSON takes them: a whole number, exactly. */
function paiseForJson(amount: Money): number {
  if (amount.amountMinor <= 0n) {
    throw new RangeError("A Razorpay order must be for more than nothing");
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
    body?: unknown
  ): Promise<unknown> {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
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
      const code = errorBody.safeParse(parsed).data?.error?.code;
      throw new RazorpayError(
        `Razorpay answered ${method} ${path.split("/")[1]} with HTTP ${response.status}` +
          (code ? ` (${code})` : "")
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
  };
}
