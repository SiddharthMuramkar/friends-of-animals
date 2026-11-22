import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  CheckoutParams,
  GatewayPayment,
  GatewayWebhook,
  Money,
  PaymentGateway,
} from "@/server/ports/payment-gateway";

// The fake signs like Razorpay does (hex HMAC-SHA256), with secrets of its
// own that are only good in tests.
const CHECKOUT_SECRET = "fake-gateway-checkout-secret";
const WEBHOOK_SECRET = "fake-gateway-webhook-secret";
const SIGNATURE_HEADER = "x-fake-gateway-signature";

function sign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sameSignature(expected: string, received: string | null): boolean {
  if (received === null || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/** An order the fake made, as the test can inspect it. */
export type FakeOrder = {
  orderId: string;
  amount: Money;
  receipt: string;
  notes: Record<string, string>;
};

/** What the fake's webhooks carry, before signing. */
type FakeWebhookBody = { id: string; event: string; orderId: string | null };

/**
 * In-memory payment gateway for Seam 1 tests, with a webhook simulator. It
 * passes the same contract as the real adapters
 * (src/server/ports/payment-gateway.contract.ts) and adds what tests need
 * to play the payer and the gateway: capture or fail an order, post signed
 * (or badly signed) webhooks, refuse the next order or the next read of
 * an order's payments, list the orders.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly name = "fake";
  readonly #orders: FakeOrder[] = [];
  readonly #payments: GatewayPayment[] = [];
  #refusals = 0;
  #fetchFailures = 0;
  #sequence = 0;

  async createOrder(order: {
    amount: Money;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ orderId: string }> {
    if (this.#refusals > 0) {
      this.#refusals -= 1;
      throw new Error("FakePaymentGateway: order refused");
    }
    if (order.amount.amountMinor <= 0n) {
      throw new Error("FakePaymentGateway: an order must be for more than 0");
    }
    const orderId = `order_fake_${this.#next()}`;
    this.#orders.push({
      orderId,
      amount: order.amount,
      receipt: order.receipt,
      notes: { ...order.notes },
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
    const expected = sign(
      CHECKOUT_SECRET,
      `${returned.orderId}|${returned.paymentId}`
    );
    return sameSignature(expected, returned.signature);
  }

  readWebhook(rawBody: string, headers: Headers): GatewayWebhook | null {
    const signature = headers.get(SIGNATURE_HEADER);
    if (!sameSignature(sign(WEBHOOK_SECRET, rawBody), signature)) return null;
    const body = JSON.parse(rawBody) as FakeWebhookBody;
    return { eventId: body.id, type: body.event, orderId: body.orderId };
  }

  async fetchOrderPayments(orderId: string): Promise<GatewayPayment[]> {
    if (this.#fetchFailures > 0) {
      this.#fetchFailures -= 1;
      throw new Error("FakePaymentGateway: payments unavailable");
    }
    return this.#payments
      .filter((payment) => payment.orderId === orderId)
      .map((payment) => ({ ...payment }));
  }

  /** Every order made so far, oldest first. */
  get orders(): readonly FakeOrder[] {
    return this.#orders;
  }

  /**
   * The payer pays `orderId`: a captured payment for the order's amount, or
   * for `amount`. Returns what Checkout hands back to the browser.
   */
  capture(
    orderId: string,
    { amount }: { amount?: Money } = {}
  ): { paymentId: string; signature: string } {
    const paymentId = this.#attempt(orderId, "captured", amount);
    return {
      paymentId,
      signature: sign(CHECKOUT_SECRET, `${orderId}|${paymentId}`),
    };
  }

  /** The payer tries to pay `orderId` and the payment fails. */
  fail(orderId: string): { paymentId: string } {
    return { paymentId: this.#attempt(orderId, "failed") };
  }

  /** Makes the next `createOrder` reject, as a gateway outage would. */
  refuseNextOrder(): void {
    this.#refusals += 1;
  }

  /** Makes the next `fetchOrderPayments` reject, as a gateway outage would. */
  failNextFetch(): void {
    this.#fetchFailures += 1;
  }

  /**
   * A new event about `orderId`, as the gateway posts it: signed with the
   * webhook secret, with another secret, or with no signature at all.
   * Passing the same body and headers again is a replay.
   */
  webhook(
    event: { type: string; orderId: string | null },
    {
      signature = "valid",
    }: { signature?: "valid" | "invalid" | "missing" } = {}
  ): { rawBody: string; headers: Headers } {
    const body: FakeWebhookBody = {
      id: `evt_fake_${this.#next()}`,
      event: event.type,
      orderId: event.orderId,
    };
    const rawBody = JSON.stringify(body);
    const headers = new Headers({ "content-type": "application/json" });
    if (signature !== "missing") {
      const secret =
        signature === "valid" ? WEBHOOK_SECRET : "not-the-webhook-secret";
      headers.set(SIGNATURE_HEADER, sign(secret, rawBody));
    }
    return { rawBody, headers };
  }

  #attempt(
    orderId: string,
    status: GatewayPayment["status"],
    amount?: Money
  ): string {
    const order = this.#orders.find((each) => each.orderId === orderId);
    if (!order) throw new Error(`FakePaymentGateway: no order ${orderId}`);
    const paid = amount ?? order.amount;
    const paymentId = `pay_fake_${this.#next()}`;
    this.#payments.push({
      id: paymentId,
      orderId,
      status,
      amountMinor: paid.amountMinor,
      currency: paid.currency,
    });
    return paymentId;
  }

  #next(): number {
    this.#sequence += 1;
    return this.#sequence;
  }
}
