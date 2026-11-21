// The payment gateway's subscription methods (#107): monthly donations run
// on gateway subscriptions, and use cases reach them only through this port.
// Adapters:
//   - Razorpay Subscriptions (src/server/ports/razorpay/subscriptions.ts),
//     over fetch with the key id and secret.
//   - the in-memory fake (src/test/fakes/subscription-gateway.ts): Seam 1.
//   - `unconfiguredSubscriptionGateway`: what production gets until the
//     Razorpay keys are wired (#77's adapter work), so nothing is charged by
//     accident.
// Every adapter passes ./subscription-gateway.contract.ts. These methods
// join #77's PaymentGateway port once it exists.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

/** A plan: one amount, charged every `interval` periods. */
export type SubscriptionPlanInput = {
  amountMinor: bigint;
  currency: "INR";
  period: "monthly";
  interval: 1;
  /** What the gateway's dashboard and the donor's bank statement show. */
  name: string;
};

export type NewSubscription = {
  planId: string;
  /** How many cycles to charge before the subscription completes. */
  totalCount: number;
  /** Always false: FOA sends the donor's messages, not the gateway. */
  customerNotify: false;
  /** Echoed back on every fetch and webhook. Strings only, no personal data. */
  notes: Record<string, string>;
};

/** A subscription as the gateway reports it. */
export type GatewaySubscription = {
  id: string;
  planId: string;
  /**
   * As the gateway sends it. Razorpay: created, authenticated, active,
   * pending, halted, cancelled, completed, expired (and paused).
   */
  status: string;
  /** Start of the billing cycle the gateway is on; null before the first. */
  currentStart: Date | null;
  /** When the gateway next tries to charge; null when it won't. */
  chargeAt: Date | null;
  /** When it was cancelled, completed or expired; null while live. */
  endedAt: Date | null;
  notes: Record<string, string>;
};

/** One payment the gateway took for a billing cycle of the subscription. */
export type GatewaySubscriptionCharge = {
  paymentId: string;
  invoiceId: string | null;
  /** True once the money was captured, even if it was refunded since. */
  captured: boolean;
  amountMinor: bigint;
  /** As the gateway sends it, e.g. "INR". */
  currency: string;
  /** True when the card or account was issued outside India. */
  international: boolean;
  /** When the payment was made at the gateway. */
  createdAt: Date;
};

/** What the browser needs to open the gateway's Checkout for a mandate. */
export type SubscriptionCheckoutParams = {
  /** The public key id; never the secret. */
  keyId: string;
  subscriptionId: string;
  description: string;
};

/** What Checkout hands back to the browser once the donor authorises. */
export type SubscriptionCheckoutReturn = {
  /** The id FOA stored, never the one the browser sent back. */
  subscriptionId: string;
  paymentId: string;
  signature: string;
};

export interface SubscriptionGateway {
  /** Creates a plan at the gateway. Reuse is the caller's job. */
  createPlan(plan: SubscriptionPlanInput): Promise<{ planId: string }>;

  /** Creates a subscription on `planId`, waiting for the donor's mandate. */
  createSubscription(
    subscription: NewSubscription
  ): Promise<GatewaySubscription>;

  /** Checkout options for authorising `subscriptionId`. Makes no call. */
  subscriptionCheckout(input: {
    subscriptionId: string;
    description: string;
  }): SubscriptionCheckoutParams;

  /** Whether Checkout's signature is genuine for this subscription. */
  verifySubscriptionCheckout(returned: SubscriptionCheckoutReturn): boolean;

  fetchSubscription(subscriptionId: string): Promise<GatewaySubscription>;

  /**
   * Every payment taken for the subscription's billing cycles, in no
   * particular order. Payments named in `except` may be left out (the
   * caller has handled them), which saves a call per payment.
   */
  fetchSubscriptionCharges(
    subscriptionId: string,
    options?: { except?: ReadonlySet<string> }
  ): Promise<GatewaySubscriptionCharge[]>;

  /**
   * Cancels at once (never at cycle end), so nothing more is charged.
   * Rejects for a subscription that has already ended.
   */
  cancelSubscription(
    subscriptionId: string,
    options: { atCycleEnd: false }
  ): Promise<GatewaySubscription>;
}

/** Gateway statuses after which a subscription never charges again. */
export const ENDED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "cancelled",
  "completed",
  "expired",
]);

/** Thrown while no gateway is configured for subscriptions. */
export class SubscriptionGatewayNotConfiguredError extends Error {
  constructor() {
    super(
      "No payment gateway is configured for subscriptions. The Razorpay " +
        "adapter is wired once the Razorpay keys exist (#77)."
    );
    this.name = "SubscriptionGatewayNotConfiguredError";
  }
}

const refuse = () => Promise.reject(new SubscriptionGatewayNotConfiguredError());

/** Refuses every call: production's gateway until Razorpay is wired. */
export const unconfiguredSubscriptionGateway: SubscriptionGateway = {
  createPlan: refuse,
  createSubscription: refuse,
  subscriptionCheckout: () => {
    throw new SubscriptionGatewayNotConfiguredError();
  },
  verifySubscriptionCheckout: () => false,
  fetchSubscription: refuse,
  fetchSubscriptionCharges: refuse,
  cancelSubscription: refuse,
};
