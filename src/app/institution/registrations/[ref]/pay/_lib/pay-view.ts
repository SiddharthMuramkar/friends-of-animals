// What the pay page's island and its server actions pass each other (#77).
// Plain JSON: paise travel as digits. No server imports, so the island can
// use it.

/** What the browser opens to pay one batch's order. */
export type CheckoutView = {
  /** Which adapter made the order: "razorpay", "razorpay-test", "fallback". */
  gateway: string;
  orderId: string;
  /** Paise, as digits. */
  amountMinor: string;
  /** The amount as the payer reads it, e.g. "₹3,000". */
  amountText: string;
  description: string;
  /** Razorpay's key id for Checkout; null for the fallback. */
  publicKey: string | null;
};

export type PayView =
  | { kind: "idle" }
  /** Open `checkout` to pay batch `batchId`. */
  | { kind: "checkout"; batchId: string; checkout: CheckoutView }
  /** A free competition: its students were confirmed. */
  | { kind: "confirmed_free"; message: string }
  | { kind: "error"; message: string };

export const IDLE: PayView = { kind: "idle" };

/** What Checkout hands back after a payment. */
export type CheckoutReturn = { paymentId: string; signature: string };

/** The fallback's test checkout's answer. */
export type TestCheckoutResult =
  | ({ ok: true } & CheckoutReturn)
  | { ok: false; message: string };
