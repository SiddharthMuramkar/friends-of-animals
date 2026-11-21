// 77a's PaymentGateway port, in the shape 77a's brief gives it, while 77a's
// own src/server/ports/payment-gateway.ts is on no branch yet. The Razorpay
// and fallback adapters (77b) implement this shape. Once 77a's port lands,
// they import it from there and this file goes. Types only.

import type { Money } from "../payments/domain/batch-amount";
import type { GatewayPayment } from "../payments/domain/capture-decision";

export type { GatewayPayment, Money };

/** Which adapter answers: Razorpay live or test mode, or a stand-in. */
export type PaymentGatewayName =
  | "razorpay"
  | "razorpay-test"
  | "fallback"
  | "fake"
  | "unconfigured";

/**
 * What the browser opens to pay an order. Plain JSON, so a Server
 * Component can hand it to the Checkout island as props.
 */
export type CheckoutParams =
  /** Razorpay Standard Checkout: the island loads checkout.js and opens
   * it with these. The key id is public; the key secret never leaves the
   * server. */
  | {
      kind: "razorpay";
      keyId: string;
      orderId: string;
      /** Paise, as Checkout's `amount` option takes it. */
      amountMinor: number;
      currency: "INR";
      description: string;
    }
  /** The non-production test checkout: the browser goes to this path. */
  | { kind: "hosted"; url: string };

/** A webhook whose signature checked out: the event and the order it names. */
export type GatewayWebhook = {
  /** Unique per event, and the same on every retry of it. */
  eventId: string;
  /** For example "payment.captured". */
  type: string;
  /** Null when the event is about no order. */
  orderId: string | null;
};

export interface PaymentGateway {
  readonly name: PaymentGatewayName;
  /** Opens an order for `amount`. `receipt` is the batch id. */
  createOrder(order: {
    amount: Money;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ orderId: string }>;
  /** What the browser needs to pay `orderId`. */
  checkout(order: {
    orderId: string;
    amount: Money;
    description: string;
  }): CheckoutParams;
  /** Whether a Checkout return is genuine. `orderId` comes from our row,
   * never from the browser. */
  verifyCheckout(returned: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  /** The webhook, or null when its signature (or event id) is missing or
   * wrong. */
  readWebhook(rawBody: string, headers: Headers): GatewayWebhook | null;
  /** Every payment attempt on `orderId`, as the gateway records it. */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
}
