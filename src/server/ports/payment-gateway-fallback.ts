// The non-production fallback adapter of the payment-gateway port (#77):
// what local runs, CI's E2E job, previews and staging pay through while no
// Razorpay test keys are set (HR-09). It plays the gateway: it makes
// orders, and its test checkout (the dialog on the pay page) lets a tester
// pay or decline one. Refunds (#80) are processed the moment they are
// made. Its record lives in the database
// (src/server/db/schema/payment-test-gateway.ts), because previews run
// serverless and an order must outlive the request that made it.
//
// It signs Checkout returns and webhooks like Razorpay (hex HMAC-SHA256),
// with a fixed key that is not a secret: anyone can pay a fallback order.
// That is safe only because it never builds when APP_ENV=production
// (../payment-gateway-select.ts picks it, and the constructor refuses).
//
// Loads under plain Node: relative imports only.

import { createHmac, timingSafeEqual } from "node:crypto";

import { and, asc, eq, ne, sum } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import {
  gatewayTestOrder,
  gatewayTestPayment,
  gatewayTestRefund,
} from "../db/schema";
import { uuidv7 } from "../ids";
import type { Clock } from "./clock";
import {
  RefundRefusedError,
  type CheckoutParams,
  type GatewayPayment,
  type GatewayRefund,
  type GatewayWebhook,
  type Money,
  type PaymentGateway,
} from "./payment-gateway";

/** Public on purpose; see the note above. */
export const FALLBACK_KEY = "foa-fallback-gateway-key-not-a-secret";
/** Where a fallback webhook carries its signature. */
export const FALLBACK_SIGNATURE_HEADER = "x-fallback-gateway-signature";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function sign(message: string): string {
  return createHmac("sha256", FALLBACK_KEY).update(message).digest("hex");
}

function sameSignature(expected: string, received: string | null): boolean {
  if (received === null || !HEX_SHA256.test(received)) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex")
  );
}

/** What the fallback's webhooks carry, before signing. */
export type FallbackWebhookBody = {
  id: string;
  event: string;
  orderId: string;
  /** For a refund event (#80). */
  refund?: { refundId: string; paymentId: string };
};

const isRefundRef = (
  value: unknown
): value is { refundId: string; paymentId: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { refundId?: unknown }).refundId === "string" &&
  typeof (value as { paymentId?: unknown }).paymentId === "string";

function parseWebhookBody(rawBody: string): FallbackWebhookBody | null {
  try {
    const body = JSON.parse(rawBody) as Partial<FallbackWebhookBody> | null;
    if (
      typeof body?.id === "string" &&
      typeof body.event === "string" &&
      typeof body.orderId === "string"
    ) {
      return {
        id: body.id,
        event: body.event,
        orderId: body.orderId,
        ...(isRefundRef(body.refund)
          ? {
              refund: {
                refundId: body.refund.refundId,
                paymentId: body.refund.paymentId,
              },
            }
          : {}),
      };
    }
  } catch {
    // Not JSON: not one of ours.
  }
  return null;
}

export class FallbackPaymentGateway implements PaymentGateway {
  readonly name = "fallback";
  readonly #db: AppDb;
  readonly #clock: Clock;

  constructor({
    db,
    clock,
    appEnv,
  }: {
    db: AppDb;
    clock: Clock;
    appEnv: string;
  }) {
    if (appEnv === "production") {
      throw new Error(
        "The fallback payment gateway takes no real money and never runs in production."
      );
    }
    this.#db = db;
    this.#clock = clock;
  }

  async createOrder({
    amount,
    receipt,
  }: {
    amount: Money;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ orderId: string }> {
    if (amount.amountMinor <= 0n) {
      throw new RangeError("A fallback order must be for more than nothing");
    }
    const now = this.#clock.now();
    const orderId = `order_fallback_${uuidv7(now).replaceAll("-", "")}`;
    await this.#db.insert(gatewayTestOrder).values({
      id: orderId,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      receipt,
      createdAt: now,
    });
    return { orderId };
  }

  checkout(order: {
    orderId: string;
    amount: Money;
    description: string;
  }): CheckoutParams {
    return { gateway: this.name, ...order, publicKey: null };
  }

  verifyCheckout(returned: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    return sameSignature(
      sign(`${returned.orderId}|${returned.paymentId}`),
      returned.signature
    );
  }

  readWebhook(rawBody: string, headers: Headers): GatewayWebhook | null {
    if (!sameSignature(sign(rawBody), headers.get(FALLBACK_SIGNATURE_HEADER))) {
      return null;
    }
    const body = parseWebhookBody(rawBody);
    if (!body) return null;
    // The id is inside the signed body, so a replay can't change it.
    return {
      eventId: body.id,
      type: body.event,
      orderId: body.orderId,
      ...(body.refund ? { refund: body.refund } : {}),
    };
  }

  async fetchOrderPayments(orderId: string): Promise<GatewayPayment[]> {
    const rows = await this.#db
      .select()
      .from(gatewayTestPayment)
      .where(eq(gatewayTestPayment.orderId, orderId))
      .orderBy(asc(gatewayTestPayment.createdAt), asc(gatewayTestPayment.id));
    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      status: row.status,
      amountMinor: row.amountMinor,
      currency: row.currency,
      // The test checkout pays with no card at all: never from abroad.
      international: false,
    }));
  }

  async refund({
    paymentId,
    amount,
    idempotencyKey,
    notes,
  }: {
    paymentId: string;
    amount: Money;
    idempotencyKey: string;
    notes: Record<string, string>;
  }): Promise<GatewayRefund> {
    return this.#db.transaction(async (tx) => {
      // Serialize both retries and balance checks on this capture.
      const [payment] = await tx
        .select()
        .from(gatewayTestPayment)
        .where(
          and(
            eq(gatewayTestPayment.id, paymentId),
            eq(gatewayTestPayment.status, "captured")
          )
        )
        .for("update");
      if (!payment) {
        throw new RefundRefusedError(
          "The fallback has no captured payment to refund"
        );
      }
      const [earlier] = await tx
        .select()
        .from(gatewayTestRefund)
        .where(eq(gatewayTestRefund.idempotencyKey, idempotencyKey));
      if (earlier) return refundView(earlier);
      const [refunded] = await tx
        .select({ total: sum(gatewayTestRefund.amountMinor) })
        .from(gatewayTestRefund)
        .where(
          and(
            eq(gatewayTestRefund.paymentId, paymentId),
            ne(gatewayTestRefund.status, "failed")
          )
        );
      const out = BigInt(refunded?.total ?? "0");
      if (
        amount.amountMinor <= 0n ||
        out + amount.amountMinor > payment.amountMinor
      ) {
        throw new RefundRefusedError(
          "A fallback refund can't be more than is left"
        );
      }
      const now = this.#clock.now();
      const [made] = await tx
        .insert(gatewayTestRefund)
        .values({
          id: `rfnd_fallback_${uuidv7(now).replaceAll("-", "")}`,
          paymentId,
          status: "processed",
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          notes,
          idempotencyKey,
          createdAt: now,
        })
        .onConflictDoNothing({ target: gatewayTestRefund.idempotencyKey })
        .returning();
      if (made) return refundView(made);
      // The globally unique key may also have been used on another payment.
      const [raced] = await tx
        .select()
        .from(gatewayTestRefund)
        .where(eq(gatewayTestRefund.idempotencyKey, idempotencyKey));
      if (!raced) throw new Error("The fallback refund vanished");
      return refundView(raced);
    });
  }

  async fetchRefunds(paymentId: string): Promise<GatewayRefund[]> {
    const rows = await this.#db
      .select()
      .from(gatewayTestRefund)
      .where(eq(gatewayTestRefund.paymentId, paymentId))
      .orderBy(asc(gatewayTestRefund.createdAt), asc(gatewayTestRefund.id));
    return rows.map(refundView);
  }

  /**
   * The tester pays `orderId` in full on the test checkout. Returns what
   * Checkout hands back to the browser, or null for an order it never made.
   */
  async capture(
    orderId: string
  ): Promise<{ paymentId: string; signature: string } | null> {
    const paymentId = await this.#attempt(orderId, "captured");
    if (!paymentId) return null;
    return { paymentId, signature: sign(`${orderId}|${paymentId}`) };
  }

  /** The tester declines: a failed attempt, which signs nothing. */
  async decline(orderId: string): Promise<{ paymentId: string } | null> {
    const paymentId = await this.#attempt(orderId, "failed");
    return paymentId ? { paymentId } : null;
  }

  async #attempt(
    orderId: string,
    status: "captured" | "failed"
  ): Promise<string | null> {
    const [order] = await this.#db
      .select()
      .from(gatewayTestOrder)
      .where(eq(gatewayTestOrder.id, orderId));
    if (!order) return null;
    const now = this.#clock.now();
    const paymentId = `pay_fallback_${uuidv7(now).replaceAll("-", "")}`;
    await this.#db.insert(gatewayTestPayment).values({
      id: paymentId,
      orderId,
      status,
      amountMinor: order.amountMinor,
      currency: order.currency,
      createdAt: now,
    });
    return paymentId;
  }
}

function refundView(row: typeof gatewayTestRefund.$inferSelect): GatewayRefund {
  return {
    id: row.id,
    paymentId: row.paymentId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    notes: { ...row.notes },
  };
}

export function fallbackPaymentGateway(options: {
  db: AppDb;
  clock: Clock;
  appEnv: string;
}): FallbackPaymentGateway {
  return new FallbackPaymentGateway(options);
}

/** Whether `gateway` is the fallback, whose test checkout can pay. */
export function isFallbackGateway(
  gateway: PaymentGateway
): gateway is FallbackPaymentGateway {
  return gateway instanceof FallbackPaymentGateway;
}
