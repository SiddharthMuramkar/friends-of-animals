import { systemClock, type Clock } from "@/server/ports/clock";
import type {
  GatewaySubscription,
  GatewaySubscriptionCharge,
  NewSubscription,
  SubscriptionPlanInput,
  SubscriptionCheckoutReturn,
} from "@/server/ports/subscription-gateway";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  RefundRefusedError,
  type CheckoutParams,
  type GatewayPayment,
  type GatewayRefund,
  type GatewayWebhook,
  type Money,
  type PaymentGateway,
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

/** An amount as a gateway reports it: its currency need not be ours. */
type GatewayAmount = Pick<GatewayPayment, "amountMinor" | "currency">;

/** A refund the fake holds, with the idempotency key it was made under. */
export type FakeRefund = GatewayRefund & { idempotencyKey: string };

type FakeRefundAnswer =
  | GatewayRefund["status"]
  | "refused"
  | "definitively_refused"
  | "lost_response";

/** What the fake's webhooks carry, before signing. */
type FakeWebhookBody = {
  id: string;
  event: string;
  orderId: string | null;
  subscriptionId?: string;
  refund?: { refundId: string; paymentId: string };
};

/**
 * In-memory payment gateway for Seam 1 tests, with a webhook simulator. It
 * passes the same contract as the real adapters
 * (src/server/ports/payment-gateway.contract.ts) and adds what tests need
 * to play the payer and the gateway: capture or fail an order, post signed
 * (or badly signed) webhooks, refuse the next order or the next read of
 * an order's payments, list the orders. For refunds (#80): list them,
 * choose how the next one answers (pending, processed, failed, refused,
 * or recorded with its answer lost), and settle a pending one later.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly name = "fake";
  readonly plans: (SubscriptionPlanInput & { planId: string })[] = [];
  readonly subscriptions: (GatewaySubscription &
    NewSubscription & { paid: number })[] = [];
  readonly cancelCalls: string[] = [];
  readonly #charges = new Map<string, GatewaySubscriptionCharge[]>();
  #cancelFailure = false;

  async createPlan(input: SubscriptionPlanInput) {
    const planId = `plan_fake_${this.#next()}`;
    this.plans.push({ ...input, planId });
    return { planId };
  }
  async createSubscription(input: NewSubscription) {
    if (!this.plans.some((p) => p.planId === input.planId))
      throw new Error("Unknown plan");
    const row = {
      ...input,
      id: `sub_fake_${this.#next()}`,
      status: "created",
      currentStart: null,
      chargeAt: null,
      endedAt: null,
      paid: 0,
    };
    this.subscriptions.push(row);
    return this.#viewSubscription(row);
  }
  #subscription(id: string) {
    const row = this.subscriptions.find((s) => s.id === id);
    if (!row) throw new Error("Unknown subscription");
    return row;
  }
  subscriptionCheckout({
    subscriptionId,
    description,
  }: {
    subscriptionId: string;
    description: string;
  }) {
    return { keyId: "rzp_test_fake", subscriptionId, description };
  }
  verifySubscriptionCheckout(returned: SubscriptionCheckoutReturn) {
    return sameSignature(
      sign(CHECKOUT_SECRET, `${returned.paymentId}|${returned.subscriptionId}`),
      returned.signature
    );
  }
  async fetchSubscription(id: string) {
    return this.#viewSubscription(this.#subscription(id));
  }
  async fetchSubscriptionCharges(
    id: string,
    options?: { except?: ReadonlySet<string> }
  ) {
    return (this.#charges.get(id) ?? [])
      .filter((c) => !options?.except?.has(c.paymentId))
      .map((c) => ({ ...c }));
  }
  async cancelSubscription(id: string, _options: { atCycleEnd: false }) {
    if (this.#cancelFailure) {
      this.#cancelFailure = false;
      throw new Error("Cancellation unavailable");
    }
    const row = this.#subscription(id);
    if (["completed", "cancelled", "expired"].includes(row.status))
      throw new Error("Subscription ended");
    this.cancelCalls.push(id);
    row.status = "cancelled";
    row.chargeAt = null;
    row.endedAt = this.clock.now();
    return this.#viewSubscription(row);
  }
  refuseNextCancel() {
    this.#cancelFailure = true;
  }
  authoriseSubscription(id: string) {
    const row = this.#subscription(id);
    if (row.status !== "created") throw new Error("Not awaiting authorisation");
    row.status = "authenticated";
    row.currentStart = this.clock.now();
    row.chargeAt = this.clock.now();
    const paymentId = `pay_mandate_${this.#next()}`;
    return {
      paymentId,
      subscriptionId: id,
      signature: sign(CHECKOUT_SECRET, `${paymentId}|${id}`),
    };
  }
  chargeSubscription(
    id: string,
    options: { at?: Date; international?: boolean } = {}
  ) {
    const row = this.#subscription(id);
    if (["cancelled", "completed", "expired", "created"].includes(row.status))
      throw new Error("Subscription not chargeable");
    const plan = this.plans.find((p) => p.planId === row.planId)!;
    const now = options.at ?? this.clock.now();
    const paymentId = `pay_fake_${this.#next()}`;
    const charge = {
      paymentId,
      invoiceId: `inv_fake_${this.#next()}`,
      captured: true,
      amountMinor: plan.amountMinor,
      currency: "INR",
      international: options.international ?? false,
      createdAt: now,
    };
    this.#payments.push({
      id: paymentId,
      orderId: id,
      status: "captured",
      amountMinor: plan.amountMinor,
      currency: "INR",
      international: charge.international,
    });
    this.#charges.set(id, [...(this.#charges.get(id) ?? []), charge]);
    row.paid++;
    row.currentStart = now;
    row.status = row.paid === row.totalCount ? "completed" : "active";
    const next = new Date(now);
    next.setUTCMonth(next.getUTCMonth() + 1);
    row.chargeAt = row.status === "completed" ? null : next;
    row.endedAt = row.status === "completed" ? now : null;
    return charge;
  }
  failSubscriptionCharge(id: string) {
    const row = this.#subscription(id);
    row.status = "pending";
    row.currentStart = row.chargeAt ?? this.clock.now();
  }
  haltSubscription(id: string) {
    this.#subscription(id).status = "halted";
  }
  runCycle() {
    for (const row of this.subscriptions) {
      if (
        ["authenticated", "active"].includes(row.status) &&
        row.chargeAt &&
        row.chargeAt <= this.clock.now()
      )
        this.chargeSubscription(row.id, { at: row.chargeAt });
    }
  }

  #viewSubscription({
    id,
    planId,
    status,
    currentStart,
    chargeAt,
    endedAt,
    notes,
  }: GatewaySubscription): GatewaySubscription {
    return {
      id,
      planId,
      status,
      currentStart,
      chargeAt,
      endedAt,
      notes: { ...notes },
    };
  }
  readonly #orders: FakeOrder[] = [];
  readonly #payments: GatewayPayment[] = [];
  readonly #refunds: FakeRefund[] = [];
  readonly #dashboardRefunds: GatewayRefund[] = [];
  readonly #refundAnswers: FakeRefundAnswer[] = [];
  #refusals = 0;
  #fetchFailures = 0;
  #sequence = 0;

  constructor(
    private readonly idNamespace = "",
    private readonly clock: Clock = systemClock
  ) {}

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
    return {
      eventId: body.id,
      type: body.event,
      orderId: body.orderId,
      ...(body.subscriptionId ? { subscriptionId: body.subscriptionId } : {}),
      ...(body.refund ? { refund: body.refund } : {}),
    };
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

  async refund(request: {
    paymentId: string;
    amount: Money;
    idempotencyKey: string;
    notes: Record<string, string>;
  }): Promise<GatewayRefund> {
    const earlier = this.#refunds.find(
      (each) => each.idempotencyKey === request.idempotencyKey
    );
    if (earlier) return this.#view(earlier);
    const answer = this.#refundAnswers.shift() ?? "processed";
    if (answer === "refused") {
      throw new Error("FakePaymentGateway: refund refused");
    }
    if (answer === "definitively_refused") {
      throw new RefundRefusedError(
        "FakePaymentGateway: refund refused for good"
      );
    }
    const payment = this.#payments.find(
      (each) => each.id === request.paymentId && each.status === "captured"
    );
    if (!payment) {
      throw new RefundRefusedError(
        `FakePaymentGateway: no captured ${request.paymentId}`
      );
    }
    const refunded = this.#refunds
      .filter(
        (each) => each.paymentId === payment.id && each.status !== "failed"
      )
      .reduce((sum, each) => sum + each.amountMinor, 0n);
    if (
      request.amount.amountMinor <= 0n ||
      refunded + request.amount.amountMinor > payment.amountMinor
    ) {
      throw new RefundRefusedError(
        "FakePaymentGateway: more than is left to refund"
      );
    }
    const refund: FakeRefund = {
      id: `rfnd_fake_${this.#next()}`,
      paymentId: payment.id,
      amountMinor: request.amount.amountMinor,
      currency: request.amount.currency,
      status: answer === "lost_response" ? "processed" : answer,
      notes: { ...request.notes },
      idempotencyKey: request.idempotencyKey,
    };
    this.#refunds.push(refund);
    if (answer === "lost_response") {
      throw new Error("FakePaymentGateway: the refund's answer was lost");
    }
    return this.#view(refund);
  }

  async fetchRefunds(paymentId: string): Promise<GatewayRefund[]> {
    return [
      ...this.#refunds.map((refund) => this.#view(refund)),
      ...this.#dashboardRefunds,
    ]
      .filter((each) => each.paymentId === paymentId)
      .map((each) => ({ ...each, notes: { ...each.notes } }));
  }

  /** Records a synthetic refund made outside the app, in the dashboard. */
  addDashboardRefund(refund: GatewayRefund): void {
    this.#dashboardRefunds.push(refund);
  }

  /** Every refund made so far, oldest first, with its idempotency key. */
  get refunds(): readonly FakeRefund[] {
    return this.#refunds;
  }

  /**
   * How the next `refund` answers: accepted and still `pending`, already
   * `processed` (the default), `failed`, `refused` (it throws and records
   * nothing), `definitively_refused` (a permanent rejection), or
   * `lost_response` (it records a processed refund, then throws).
   */
  answerNextRefund(answer: FakeRefundAnswer): void {
    this.#refundAnswers.push(answer);
  }

  /** The gateway finishes a pending refund: processed or failed. */
  settleRefund(refundId: string, status: "processed" | "failed"): void {
    const refund = this.#refunds.find((each) => each.id === refundId);
    if (!refund) throw new Error(`FakePaymentGateway: no refund ${refundId}`);
    refund.status = status;
  }

  /** Every order made so far, oldest first. */
  get orders(): readonly FakeOrder[] {
    return this.#orders;
  }

  /**
   * The payer pays `orderId`: a captured payment for the order's amount, or
   * for `amount`, in any currency the gateway might report, on a card from
   * abroad when `international` (#106). Returns what Checkout hands back to
   * the browser.
   */
  capture(
    orderId: string,
    {
      amount,
      international = false,
    }: { amount?: GatewayAmount; international?: boolean } = {}
  ): { paymentId: string; signature: string } {
    const paymentId = this.#attempt(orderId, "captured", amount, international);
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
    event: {
      type: string;
      orderId: string | null;
      subscriptionId?: string;
      refund?: { refundId: string; paymentId: string };
    },
    {
      signature = "valid",
    }: { signature?: "valid" | "invalid" | "missing" } = {}
  ): { rawBody: string; headers: Headers } {
    const body: FakeWebhookBody = {
      id: `evt_fake_${this.#next()}`,
      event: event.type,
      orderId: event.orderId,
      ...(event.subscriptionId ? { subscriptionId: event.subscriptionId } : {}),
      ...(event.refund ? { refund: event.refund } : {}),
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
    amount?: GatewayAmount,
    international = false
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
      international,
    });
    return paymentId;
  }

  #view({ idempotencyKey: _key, ...refund }: FakeRefund): GatewayRefund {
    return { ...refund, notes: { ...refund.notes } };
  }

  #next(): string {
    this.#sequence += 1;
    return `${this.idNamespace}${this.#sequence}`;
  }
}
