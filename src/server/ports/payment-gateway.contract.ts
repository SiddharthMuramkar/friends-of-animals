// Shared contract for every PaymentGateway adapter. The in-memory fake runs
// it here (77a); the Razorpay adapter over a fetch double and the fallback
// adapter on PGlite run it in 77b. A fake that passes a check a real adapter
// fails is wrong. Only imported by *.test.ts.

import { describe, expect, it } from "vitest";

import type { Money, PaymentGateway } from "./payment-gateway";

export type PaymentGatewayContractSetup = () => Promise<{
  gateway: PaymentGateway;
  /**
   * Has the payer pay `orderId` in full: the gateway records a captured
   * payment, and this returns what Checkout hands back to the browser.
   */
  capture: (
    orderId: string,
    amount: Money
  ) => Promise<{ paymentId: string; signature: string }>;
  /**
   * A new event (with its own id) about `orderId`, as the gateway would
   * post it: signed, signed with the wrong secret, or with no signature.
   */
  webhook: (
    event: {
      type: string;
      orderId: string;
      /** For a refund event (#80): the refund and its payment. */
      refund?: { refundId: string; paymentId: string };
    },
    options?: { signature?: "valid" | "invalid" | "missing" }
  ) => { rawBody: string; headers: Headers };
}>;

const FEES: Money = { amountMinor: 250000n, currency: "INR" };

export function paymentGatewayContract(
  name: string,
  setup: PaymentGatewayContractSetup
) {
  describe(`${name} (PaymentGateway contract)`, () => {
    async function openOrder(amount: Money = FEES) {
      const world = await setup();
      const { orderId } = await world.gateway.createOrder({
        amount,
        receipt: "0193a8f0-0000-7000-8000-000000000001",
        notes: { batchId: "0193a8f0-0000-7000-8000-000000000001" },
      });
      return { ...world, orderId };
    }

    it("opens an order and gives the checkout for it", async () => {
      const { gateway, orderId } = await openOrder();

      expect(orderId).toMatch(/\S/);
      expect(
        gateway.checkout({ orderId, amount: FEES, description: "Fees" })
      ).toMatchObject({
        gateway: gateway.name,
        orderId,
        amount: FEES,
        description: "Fees",
      });
    });

    it("gives every order its own id", async () => {
      const { gateway, orderId } = await openOrder();
      const second = await gateway.createOrder({
        amount: FEES,
        receipt: "0193a8f0-0000-7000-8000-000000000002",
        notes: {},
      });

      expect(second.orderId).not.toBe(orderId);
    });

    it("refuses an order for nothing", async () => {
      const { gateway } = await setup();

      await expect(
        gateway.createOrder({
          amount: { amountMinor: 0n, currency: "INR" },
          receipt: "0193a8f0-0000-7000-8000-000000000003",
          notes: {},
        })
      ).rejects.toThrow();
    });

    it("reports no payments on a new order", async () => {
      const { gateway, orderId } = await openOrder();

      expect(await gateway.fetchOrderPayments(orderId)).toEqual([]);
    });

    it("reports a captured payment with its exact amount in paise", async () => {
      const amount: Money = { amountMinor: 2147483649n, currency: "INR" };
      const { gateway, orderId, capture } = await openOrder(amount);

      const { paymentId } = await capture(orderId, amount);

      expect(await gateway.fetchOrderPayments(orderId)).toEqual([
        {
          id: paymentId,
          orderId,
          status: "captured",
          amountMinor: 2147483649n,
          currency: "INR",
        },
      ]);
    });

    it("keeps each order's payments apart", async () => {
      const { gateway, orderId, capture } = await openOrder();
      const other = await gateway.createOrder({
        amount: FEES,
        receipt: "0193a8f0-0000-7000-8000-000000000004",
        notes: {},
      });

      await capture(orderId, FEES);

      expect(await gateway.fetchOrderPayments(other.orderId)).toEqual([]);
    });

    it("trusts the signature Checkout hands back for that payment", async () => {
      const { gateway, orderId, capture } = await openOrder();

      const { paymentId, signature } = await capture(orderId, FEES);

      expect(gateway.verifyCheckout({ orderId, paymentId, signature })).toBe(
        true
      );
    });

    it("refuses that signature for another order or payment, or changed", async () => {
      const { gateway, orderId, capture } = await openOrder();
      const other = await gateway.createOrder({
        amount: FEES,
        receipt: "0193a8f0-0000-7000-8000-000000000005",
        notes: {},
      });
      const { paymentId, signature } = await capture(orderId, FEES);
      const changed =
        signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");

      for (const returned of [
        { orderId: other.orderId, paymentId, signature },
        { orderId, paymentId: `${paymentId}x`, signature },
        { orderId, paymentId, signature: changed },
        { orderId, paymentId, signature: "" },
      ]) {
        expect(gateway.verifyCheckout(returned)).toBe(false);
      }
    });

    it("reads a webhook whose signature is genuine", async () => {
      const { gateway, orderId, webhook } = await openOrder();
      const { rawBody, headers } = webhook({
        type: "payment.captured",
        orderId,
      });

      expect(gateway.readWebhook(rawBody, headers)).toEqual({
        eventId: expect.stringMatching(/\S/),
        type: "payment.captured",
        orderId,
      });
    });

    it("gives a replayed webhook the same event id, and a new event a new one", async () => {
      const { gateway, orderId, webhook } = await openOrder();
      const first = webhook({ type: "payment.captured", orderId });
      const second = webhook({ type: "payment.captured", orderId });

      const once = gateway.readWebhook(first.rawBody, first.headers);
      const again = gateway.readWebhook(first.rawBody, first.headers);
      const next = gateway.readWebhook(second.rawBody, second.headers);

      expect(again?.eventId).toBe(once?.eventId);
      expect(next?.eventId).not.toBe(once?.eventId);
    });

    it("refuses a webhook with a wrong or missing signature", async () => {
      const { gateway, orderId, webhook } = await openOrder();

      for (const signature of ["invalid", "missing"] as const) {
        const { rawBody, headers } = webhook(
          { type: "payment.captured", orderId },
          { signature }
        );
        expect(gateway.readWebhook(rawBody, headers)).toBeNull();
      }
    });

    // Refunds (#80). Never a real gateway call: each adapter runs these
    // against its own double.
    async function capturedPayment(amount: Money = FEES) {
      const world = await openOrder(amount);
      const { paymentId } = await world.capture(world.orderId, amount);
      return { ...world, paymentId };
    }

    const KEY = "0193a8f0-0000-7000-8000-00000000f001-1";

    it("reports no refunds on a captured payment that has none", async () => {
      const { gateway, paymentId } = await capturedPayment();

      expect(await gateway.fetchRefunds(paymentId)).toEqual([]);
    });

    it("refunds part of a captured payment for the exact amount in paise, with its notes, and lists it", async () => {
      const { gateway, paymentId } = await capturedPayment();
      const notes = { refundId: "0193a8f0-0000-7000-8000-00000000f001" };

      const refund = await gateway.refund({
        paymentId,
        amount: { amountMinor: 100_001n, currency: "INR" },
        idempotencyKey: KEY,
        notes,
      });

      expect(refund).toEqual({
        id: expect.stringMatching(/\S/),
        paymentId,
        amountMinor: 100_001n,
        currency: "INR",
        status: expect.stringMatching(/^(pending|processed)$/),
        notes,
      });
      expect(await gateway.fetchRefunds(paymentId)).toEqual([
        { ...refund, status: expect.stringMatching(/^(pending|processed)$/) },
      ]);
    });

    it("returns the same refund for the same idempotency key, and refunds once", async () => {
      const { gateway, paymentId } = await capturedPayment();
      const request = {
        paymentId,
        amount: { amountMinor: 50_000n, currency: "INR" as const },
        idempotencyKey: KEY,
        notes: { refundId: "0193a8f0-0000-7000-8000-00000000f001" },
      };

      const first = await gateway.refund(request);
      const again = await gateway.refund(request);

      expect(again.id).toBe(first.id);
      expect(await gateway.fetchRefunds(paymentId)).toHaveLength(1);
    });

    it("refunds the rest under another key, and refuses more than is left", async () => {
      const { gateway, paymentId } = await capturedPayment();
      const refund = (amountMinor: bigint, idempotencyKey: string) =>
        gateway.refund({
          paymentId,
          amount: { amountMinor, currency: "INR" },
          idempotencyKey,
          notes: {},
        });

      await refund(200_000n, KEY);
      await refund(50_000n, `${KEY}0`);

      await expect(refund(1n, `${KEY}00`)).rejects.toThrow();
      expect(
        (await gateway.fetchRefunds(paymentId)).map((each) => each.amountMinor)
      ).toEqual(expect.arrayContaining([200_000n, 50_000n]));
    });

    it("keeps each payment's refunds apart", async () => {
      const { gateway, paymentId, capture } = await capturedPayment();
      const other = await gateway.createOrder({
        amount: FEES,
        receipt: "0193a8f0-0000-7000-8000-000000000006",
        notes: {},
      });
      const second = await capture(other.orderId, FEES);

      await gateway.refund({
        paymentId,
        amount: FEES,
        idempotencyKey: KEY,
        notes: {},
      });

      expect(await gateway.fetchRefunds(second.paymentId)).toEqual([]);
    });

    it("reads a refund webhook with the refund and the payment it returns", async () => {
      const { gateway, orderId, paymentId, webhook } = await capturedPayment();
      const refund = await gateway.refund({
        paymentId,
        amount: FEES,
        idempotencyKey: KEY,
        notes: {},
      });
      const { rawBody, headers } = webhook({
        type: "refund.processed",
        orderId,
        refund: { refundId: refund.id, paymentId },
      });

      expect(gateway.readWebhook(rawBody, headers)).toEqual({
        eventId: expect.stringMatching(/\S/),
        type: "refund.processed",
        orderId,
        refund: { refundId: refund.id, paymentId },
      });
    });

    it("refuses a webhook whose body changed after it was signed", async () => {
      const { gateway, orderId, webhook } = await openOrder();
      const { rawBody, headers } = webhook({
        type: "payment.captured",
        orderId,
      });

      expect(gateway.readWebhook(`${rawBody} `, headers)).toBeNull();
    });
  });
}
