// The payment-gateway port (#77). Use cases take payments through it and
// never pick a provider. Adapters:
//   - the in-memory fake with a webhook simulator
//     (src/test/fakes/payment-gateway.ts): Seam 1 tests.
//   - Razorpay over fetch, and a non-production fallback with a hosted test
//     checkout: 77b.
//   - `unconfiguredPaymentGateway`: production until 77b wires Razorpay. It
//     refuses everything, so no payment is ever taken by accident.
// Every adapter passes ./payment-gateway.contract.ts.
//
// The gateway's record is the truth: a Checkout return or a webhook only
// names an order, and the use case then reads the order's payments back
// through `fetchOrderPayments` (src/server/payments/sync-batch.ts).
//
// Loads under plain Node: relative type imports only.

import type { Money } from "../payments/domain/batch-amount";
import type { GatewayPayment } from "../payments/domain/capture-decision";

export type { GatewayPayment, Money };

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
}

/** Thrown in production while no payment gateway is configured. */
export class PaymentGatewayNotConfiguredError extends Error {
  constructor() {
    super(
      "No payment gateway is configured. The Razorpay adapter arrives with " +
        "77b; until then nothing can be paid."
    );
    this.name = "PaymentGatewayNotConfiguredError";
  }
}

/**
 * Production's gateway until 77b wires Razorpay: it makes no order, opens no
 * checkout, and trusts no signature.
 */
export const unconfiguredPaymentGateway: PaymentGateway = {
  name: "unconfigured",
  createOrder: () => Promise.reject(new PaymentGatewayNotConfiguredError()),
  checkout: () => {
    throw new PaymentGatewayNotConfiguredError();
  },
  verifyCheckout: () => false,
  readWebhook: () => null,
  fetchOrderPayments: () =>
    Promise.reject(new PaymentGatewayNotConfiguredError()),
};
