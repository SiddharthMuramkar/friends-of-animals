import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { auditLog, paymentBatch, paymentBatchItem } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import {
  paymentRows,
  schoolWithStudents,
} from "@/server/modules/payments/testing";
import { unconfiguredPaymentGateway } from "@/server/ports/payment-gateway";
import { createHarness, type Harness } from "@/test/harness";

import {
  adultForm,
  INDIVIDUAL_FEE,
  openToIndividuals,
  signInMember,
} from "./testing";

const REGISTRATION_NUMBER = /^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$/;

/** A signed-in adult registered for a competition with `fee`, not yet paid. */
async function registered(h: Harness, fee: bigint = INDIVIDUAL_FEE) {
  const competition = await openToIndividuals(h, { fee, code: "NEIGH27" });
  const adult = await signInMember(h, { name: "Ravi Kumar" });
  const result = await h
    .as(adult.actor)
    .registerAsIndividual(adultForm(competition, { fullName: "Ravi Kumar" }));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return {
    ...adult,
    competition,
    registrationId: result.registrationId,
    participantCode: result.participantCode,
    pay: (actor = adult.actor) =>
      h
        .as(actor)
        .payForMyRegistration({ registrationId: result.registrationId }),
    status: async () => {
      const [mine] = await h.as(adult.actor).listMyRegistrations();
      return mine;
    },
  };
}

async function openOrder(
  h: Harness,
  adult: Awaited<ReturnType<typeof registered>>
) {
  const result = await adult.pay();
  if (!result.ok || result.kind !== "checkout") {
    throw new Error(`No order: ${JSON.stringify(result)}`);
  }
  return { batchId: result.batchId, orderId: result.checkout.orderId };
}

const capturedWebhook = (h: Harness, orderId: string) =>
  h
    .as(h.visitor())
    .receiveGatewayWebhook(
      h.gateway.webhook({ type: "payment.captured", orderId })
    );

describe("payForMyRegistration", () => {
  it("opens one batch of one at the individual fee, with one gateway order for that amount", async () => {
    const h = await createHarness();
    const ravi = await registered(h);

    const result = await ravi.pay();

    expect(result).toMatchObject({ ok: true, kind: "checkout" });
    if (!result.ok || result.kind !== "checkout") return;
    expect(h.gateway.orders).toEqual([
      {
        orderId: result.checkout.orderId,
        amount: { amountMinor: 25_000n, currency: "INR" },
        receipt: result.batchId,
        notes: {
          batchId: result.batchId,
          participantCode: ravi.participantCode,
        },
      },
    ]);
    expect(result.checkout).toEqual({
      gateway: "fake",
      orderId: result.checkout.orderId,
      amount: { amountMinor: 25_000n, currency: "INR" },
      description: `Registration fee for Seed competition 1 (${ravi.participantCode})`,
      publicKey: null,
    });
    const [batch] = await h.db
      .select()
      .from(paymentBatch)
      .where(eq(paymentBatch.id, result.batchId));
    expect(batch).toMatchObject({
      route: "individual",
      institutionId: null,
      institutionRegistrationId: null,
      competitionId: ravi.competition.id,
      payerUserId: ravi.userId,
      status: "order_created",
      amountMinor: 25_000n,
      gatewayOrderId: result.checkout.orderId,
    });
    const items = await h.db
      .select()
      .from(paymentBatchItem)
      .where(eq(paymentBatchItem.batchId, result.batchId));
    expect(items).toEqual([
      {
        batchId: result.batchId,
        registrationId: ravi.registrationId,
        amountMinor: 25_000n,
        releasedAt: null,
      },
    ]);
    // Nothing is confirmed until the gateway says the money arrived.
    expect(await ravi.status()).toMatchObject({
      status: "pending_payment",
      registrationNumber: null,
      amountDue: { amountMinor: 25_000n, currency: "INR" },
    });
  });

  it("returns the same open order when asked again, without a second order", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const first = await openOrder(h, ravi);

    const again = await ravi.pay();

    expect(again).toMatchObject({
      ok: true,
      kind: "checkout",
      batchId: first.batchId,
      checkout: { orderId: first.orderId },
    });
    expect(h.gateway.orders).toHaveLength(1);
    expect(await h.db.select().from(paymentBatch)).toHaveLength(1);
  });

  it("confirms a free competition at once, with a registration number and no order", async () => {
    const h = await createHarness();
    const ravi = await registered(h, 0n);

    const result = await ravi.pay();

    expect(result).toEqual({
      ok: true,
      kind: "confirmed_free",
      registrationNumber: expect.stringMatching(REGISTRATION_NUMBER),
    });
    if (!result.ok || result.kind !== "confirmed_free") return;
    expect(result.registrationNumber).toMatch(/^NEIGH27-R-/);
    expect(h.gateway.orders).toEqual([]);
    expect(await h.db.select().from(paymentBatch)).toEqual([]);
    expect(await ravi.status()).toMatchObject({
      status: "confirmed",
      registrationNumber: result.registrationNumber,
      amountDue: null,
    });
    // Asked again, it is already confirmed.
    expect(await ravi.pay()).toEqual({
      ok: true,
      kind: "confirmed",
      registrationNumber: result.registrationNumber,
    });
  });

  it("confirms the registration with a number once the gateway captures the payment, and a replay changes nothing", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const { orderId } = await openOrder(h, ravi);
    h.gateway.capture(orderId);
    const webhook = h.gateway.webhook({ type: "payment.captured", orderId });

    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "captured",
    });
    const confirmed = await ravi.status();
    expect(confirmed).toMatchObject({ status: "confirmed", amountDue: null });
    expect(confirmed?.registrationNumber).toMatch(REGISTRATION_NUMBER);
    expect(confirmed?.registrationNumber).toMatch(/^NEIGH27-R-/);
    const before = await paymentRows(h);

    expect(await h.as(h.visitor()).receiveGatewayWebhook(webhook)).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    expect(await capturedWebhook(h, orderId)).toEqual({
      ok: true,
      outcome: "already_captured",
    });
    const after = await paymentRows(h);
    expect({ ...after, webhooks: [] }).toEqual({ ...before, webhooks: [] });
    expect(await ravi.status()).toEqual(confirmed);
  });

  it("confirms on the Checkout return when its signature is genuine, and refuses one that isn't", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const { orderId } = await openOrder(h, ravi);
    const { paymentId, signature } = h.gateway.capture(orderId);

    expect(
      await h.as(ravi.actor).confirmMyPayment({
        registrationId: ravi.registrationId,
        paymentId,
        signature: `${signature}x`,
      })
    ).toEqual({ ok: false, error: "invalid_signature" });
    expect((await ravi.status())?.status).toBe("pending_payment");

    expect(
      await h.as(ravi.actor).confirmMyPayment({
        registrationId: ravi.registrationId,
        paymentId,
        signature,
      })
    ).toEqual({ ok: true, outcome: "captured" });
    expect((await ravi.status())?.status).toBe("confirmed");
  });

  it("checks an open order with the gateway before giving it out again, and finds it paid", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const { orderId } = await openOrder(h, ravi);
    h.gateway.capture(orderId);

    const result = await ravi.pay();

    expect(result).toEqual({
      ok: true,
      kind: "confirmed",
      registrationNumber: expect.stringMatching(REGISTRATION_NUMBER),
    });
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("fails the batch and lets the registration go when the gateway refuses the order", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    h.gateway.refuseNextOrder();

    expect(await ravi.pay()).toEqual({
      ok: false,
      error: "gateway_unavailable",
    });
    const [batch] = await h.db.select().from(paymentBatch);
    expect(batch?.status).toBe("failed");
    expect(
      (await h.db.select().from(paymentBatchItem))[0]?.releasedAt
    ).not.toBeNull();

    // A later try opens a new order.
    expect(await ravi.pay()).toMatchObject({ ok: true, kind: "checkout" });
  });

  it("takes no payment while no gateway is configured, as in production until 77b", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const app = createApp({ ...h.deps, payments: unconfiguredPaymentGateway });

    expect(
      await app
        .as(ravi.actor)
        .payForMyRegistration({ registrationId: ravi.registrationId })
    ).toEqual({ ok: false, error: "gateway_unavailable" });
    expect((await ravi.status())?.status).toBe("pending_payment");
  });

  it("writes the order to the audit log with ids only", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const { batchId, orderId } = await openOrder(h, ravi);

    const [entry] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "payment.batch_created"));
    expect(entry).toMatchObject({
      actorUserId: ravi.userId,
      entityType: "payment_batch",
      entityId: batchId,
      after: {
        status: "order_created",
        route: "individual",
        amountMinor: "25000",
        registrationIds: [ravi.registrationId],
        gatewayOrderId: orderId,
      },
    });
  });

  describe("who may pay", () => {
    it("refuses a visitor and another member, the same way as a registration that doesn't exist", async () => {
      const h = await createHarness();
      const ravi = await registered(h);
      const other = await signInMember(h);

      await expect(ravi.pay(h.visitor())).rejects.toThrow(DomainError);
      await expect(ravi.pay(other.actor)).rejects.toThrow(DomainError);
      await expect(
        h.as(other.actor).payForMyRegistration({
          registrationId: "01938a00-0000-7000-8000-00000000dead",
        })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(other.actor).confirmMyPayment({
          registrationId: ravi.registrationId,
          paymentId: "pay_x",
          signature: "sig",
        })
      ).rejects.toThrow(DomainError);
      expect(h.gateway.orders).toEqual([]);
      expect(await h.db.select().from(paymentBatch)).toEqual([]);
    });

    it("refuses a school's student registration, which no member owns", async () => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 1 });
      const member = await signInMember(h);

      await expect(
        h.as(member.actor).payForMyRegistration({
          registrationId: school.registrationIds[0]!,
        })
      ).rejects.toThrow(DomainError);
    });
  });
});

describe("payForMyRegistration while a payment is in review (#79)", () => {
  it("opens no second order for a registration staff are deciding about", async () => {
    const h = await createHarness();
    const ravi = await registered(h);
    const { batchId, orderId } = await openOrder(h, ravi);
    h.gateway.capture(orderId, {
      amount: { amountMinor: 1n, currency: "INR" },
    });
    await capturedWebhook(h, orderId);
    const [batch] = await h.db
      .select({ status: paymentBatch.status })
      .from(paymentBatch)
      .where(eq(paymentBatch.id, batchId));
    expect(batch?.status).toBe("needs_review");
    const orders = h.gateway.orders.length;

    expect(await ravi.pay()).toEqual({ ok: false, error: "nothing_to_pay" });
    expect(h.gateway.orders).toHaveLength(orders);
  });
});
