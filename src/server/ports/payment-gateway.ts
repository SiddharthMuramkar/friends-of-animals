// The payment-gateway port (#77). Use cases take payments through it and
// never pick a provider. Adapters:
//   - the in-memory fake with a webhook simulator
//     (src/test/fakes/payment-gateway.ts): Seam 1 tests.
//   - Razorpay over fetch (./razorpay/gateway.ts), and a non-production
//     fallback with a test checkout (./payment-gateway-fallback.ts).
//   - `unconfiguredGateway(reason)`: production while Razorpay's live keys
//     are missing. It refuses everything, so no payment is ever taken by
//     accident.
// ./payment-gateway-select.ts picks one per environment. Every adapter
// passes ./payment-gateway.contract.ts.
//
// The gateway's record is the truth: a Checkout return or a webhook only
// names an order, and the use case then reads the order's payments back
// through `fetchOrderPayments` (src/server/modules/payments/sync-batch.ts).
//
// Refunds (#80) follow the same rule: `refund` asks for one, keyed by an
// idempotency key so a retry never refunds twice, and every later signal
// (a refund webhook, a retry) reads the payment's refunds back through
// `fetchRefunds` (src/server/modules/payments/refunds/sync-refund.ts).
//
// Loads under plain Node: relative type imports only.

import type { Money } from "../modules/payments/domain/batch-amount";
import type { GatewayPayment } from "../modules/payments/domain/capture-decision";
import type { GatewayRefund } from "../modules/payments/domain/refund-sync";

export type { GatewayPayment, GatewayRefund, Money };

/** Which adapter made an order; stored with the batch. */
export const GATEWAY_NAMES = [
  "razorpay",
  "razorpay-test",
  "fallback",
  "fake",
  "unconfigured",
] as const;

export type GatewayName = (typeof GATEWAY_NAMES)[number];

/** What the browser needs to open the gateway's checkout for one order. */
export type CheckoutParams = {
  gateway: GatewayName;
  orderId: string;
  amount: Money;
  description: string;
  /** The key the gateway's checkout script takes. Public, never a secret;
   * null for an adapter with no script (the fake, the fallback). */
  publicKey: string | null;
};

/** A webhook whose signature checked out: which event, about which order. */
export type GatewayWebhook = {
  /** The gateway's id for this event; a replay repeats it. */
  eventId: string;
  /** The gateway's event name, e.g. "payment.captured". */
  type: string;
  /** The order it is about, or null for an event about no order. */
  orderId: string | null;
  /** For a refund event (#80): the gateway's refund and the payment it
   * returns. Absent on every other event. */
  refund?: { refundId: string; paymentId: string };
};

export interface PaymentGateway {
  readonly name: GatewayName;

  /**
   * Opens an order for `amount`, which must be more than zero. `receipt` is
   * our payment batch's id. Rejects if the gateway refuses.
   */
  createOrder(order: {
    amount: Money;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ orderId: string }>;

  /** What the browser opens to pay `orderId`. */
  checkout(order: {
    orderId: string;
    amount: Money;
    description: string;
  }): CheckoutParams;

  /**
   * Whether the signature Checkout handed back is genuine for this payment
   * on this order. Pass the order id stored with the batch, never the one
   * the browser sent back.
   */
  verifyCheckout(returned: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;

  /**
   * The webhook's event, or null when its signature is missing or wrong.
   * Checks the raw body as received, before anything parses it.
   */
  readWebhook(rawBody: string, headers: Headers): GatewayWebhook | null;

  /** Every payment attempt on `orderId`, as the gateway records it. */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;

  /**
   * Refunds `amount` of the captured payment `paymentId` (#80): all of it
   * or part. A second call with the same `idempotencyKey` returns the
   * refund the first made instead of refunding again. Rejects if the
   * gateway refuses, for example for more than is left of the payment.
   */
  refund(request: {
    paymentId: string;
    amount: Money;
    idempotencyKey: string;
    notes: Record<string, string>;
  }): Promise<GatewayRefund>;

  /** Every refund of `paymentId`, as the gateway records it. */
  fetchRefunds(paymentId: string): Promise<GatewayRefund[]>;
}

/** Thrown in production while no payment gateway is configured. */
export class PaymentGatewayNotConfiguredError extends Error {
  constructor(
    reason = "Production takes payments through Razorpay's live keys " +
      "(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET), " +
      "which are not set."
  ) {
    super(
      `No payment gateway is configured, so nothing can be paid. ${reason}`
    );
    this.name = "PaymentGatewayNotConfiguredError";
  }
}

/**
 * The gateway while none is configured: it makes no order, opens no
 * checkout, and trusts no signature. What it throws gives `reason`, or by
 * default that Razorpay's live keys are not set.
 */
export function unconfiguredGateway(reason?: string): PaymentGateway {
  const refuse = () => new PaymentGatewayNotConfiguredError(reason);
  return {
    name: "unconfigured",
    createOrder: () => Promise.reject(refuse()),
    checkout: () => {
      throw refuse();
    },
    verifyCheckout: () => false,
    readWebhook: () => null,
    fetchOrderPayments: () => Promise.reject(refuse()),
    refund: () => Promise.reject(refuse()),
    fetchRefunds: () => Promise.reject(refuse()),
  };
}

/** The unconfigured gateway with the default reason. */
export const unconfiguredPaymentGateway: PaymentGateway = unconfiguredGateway();
