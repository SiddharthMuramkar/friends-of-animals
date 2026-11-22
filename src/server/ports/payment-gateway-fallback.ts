// The non-production fallback adapter of the payment-gateway port (#77):
// what local runs, CI's E2E job, previews and staging pay through while no
// Razorpay test keys are set (HR-09). It plays the gateway: it makes
// orders, and its test checkout (the dialog on the pay page) lets a tester
// pay or decline one. Its record lives in the database
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

import { asc, eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { gatewayTestOrder, gatewayTestPayment } from "../db/schema";
import { uuidv7 } from "../ids";
import type { Clock } from "./clock";
import type {
  CheckoutParams,
  GatewayPayment,
  GatewayWebhook,
  Money,
  PaymentGateway,
} from "./payment-gateway";

/** Public on purpose; see the note above. */
const FALLBACK_KEY = "foa-fallback-gateway-key-not-a-secret";
const SIGNATURE_HEADER = "x-fallback-gateway-signature";

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
type FallbackWebhookBody = { id: string; event: string; orderId: string };

function parseWebhookBody(rawBody: string): FallbackWebhookBody | null {
  try {
    const body = JSON.parse(rawBody) as Partial<FallbackWebhookBody> | null;
    if (
      typeof body?.id === "string" &&
      typeof body.event === "string" &&
      typeof body.orderId === "string"
    ) {
      return { id: body.id, event: body.event, orderId: body.orderId };
    }
  } catch {
    // Not JSON: not one of ours.
  }
  return null;
}

let webhookSequence = 0;

/**
 * A webhook as the fallback would post one, for tests: signed with its
 * key, with another key, or unsigned. A new call is a new event.
 */
export function fallbackWebhook(
  event: { type: string; orderId: string },
  { signature = "valid" }: { signature?: "valid" | "invalid" | "missing" } = {}
): { rawBody: string; headers: Headers } {
  webhookSequence += 1;
  const body: FallbackWebhookBody = {
    id: `evt_fallback_${Date.now()}_${webhookSequence}`,
    event: event.type,
    orderId: event.orderId,
  };
  const rawBody = JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json" });
  if (signature === "valid") headers.set(SIGNATURE_HEADER, sign(rawBody));
  if (signature === "invalid") {
    headers.set(
      SIGNATURE_HEADER,
      createHmac("sha256", "not-the-fallback-key").update(rawBody).digest("hex")
    );
  }
  return { rawBody, headers };
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
    if (!sameSignature(sign(rawBody), headers.get(SIGNATURE_HEADER))) {
      return null;
    }
    const body = parseWebhookBody(rawBody);
    if (!body) return null;
    // The id is inside the signed body, so a replay can't change it.
    return { eventId: body.id, type: body.event, orderId: body.orderId };
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
    }));
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
