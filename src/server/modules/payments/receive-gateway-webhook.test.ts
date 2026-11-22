import { and, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, gatewayWebhookEvent } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { REGISTRATION_NUMBER } from "@/server/modules/registration/domain/registration-number";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchRow,
  enrol,
  openOrder,
  paymentRows,
  registrationsOf,
  reviewCasesOf,
  schoolWithStudents,
} from "./testing";

/** The gateway posts `payment.captured` for `orderId`, as a visitor. */
function capturedWebhook(
  h: Harness,
  orderId: string,
  signature?: "valid" | "invalid" | "missing"
) {
  return h.gateway.webhook(
    { type: "payment.captured", orderId },
    signature ? { signature } : {}
  );
}

const receive = (h: Harness, webhook: { rawBody: string; headers: Headers }) =>
  h.as(h.visitor()).receiveGatewayWebhook(webhook);

describe("receiveGatewayWebhook", () => {
  it("confirms every registration in the batch with a unique number once the gateway captured the payment", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });
    const { batchId, orderId } = await openOrder(school);
    h.clock.advance({ minutes: 5 });
    const { paymentId } = h.gateway.capture(orderId);

    const result = await receive(h, capturedWebhook(h, orderId));

    expect(result).toEqual({ ok: true, outcome: "captured" });
    const registrations = await registrationsOf(h, school.registrationIds);
    expect(registrations.map((r) => r.status)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);
    const numbers = registrations.map((r) => r.registrationNumber ?? "");
    for (const number of numbers) {
      expect(number).toMatch(REGISTRATION_NUMBER);
      expect(number).toMatch(/^PAWS27-R-/);
    }
    expect(new Set(numbers).size).toBe(3);
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "captured",
      gatewayPaymentId: paymentId,
      capturedAt: h.clock.now(),
    });
  });

  it("keeps each webhook's event id and what it led to, never its body", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { orderId } = await openOrder(school);
    h.gateway.capture(orderId);
    const webhook = capturedWebhook(h, orderId);

    await receive(h, webhook);

    const { id: eventId } = JSON.parse(webhook.rawBody) as { id: string };
    expect(await h.db.select().from(gatewayWebhookEvent)).toEqual([
      {
        id: expect.any(String),
        gateway: "fake",
        eventId,
        type: "payment.captured",
        orderId,
        outcome: "captured",
        receivedAt: h.clock.now(),
        processedAt: h.clock.now(),
      },
    ]);
  });

  it("answers a replayed webhook as a duplicate and changes nothing", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { orderId } = await openOrder(school);
    h.gateway.capture(orderId);
    const webhook = capturedWebhook(h, orderId);
    await receive(h, webhook);
    const before = await paymentRows(h);
    h.clock.advance({ minutes: 1 });

    const replayed = await receive(h, webhook);

    expect(replayed).toEqual({ ok: true, outcome: "duplicate" });
    expect(await paymentRows(h)).toEqual(before);
  });

  it.each(["invalid", "missing"] as const)(
    "rejects a webhook with a %s signature and stores nothing",
    async (signature) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h);
      const { orderId } = await openOrder(school);
      h.gateway.capture(orderId);
      const before = await paymentRows(h);

      const result = await receive(h, capturedWebhook(h, orderId, signature));

      expect(result).toEqual({ ok: false, error: "rejected" });
      expect(await paymentRows(h)).toEqual(before);
    }
  );

  it("takes a genuine webhook from a signed-in user too, since the signature is what authorises it", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { orderId } = await openOrder(school);
    h.gateway.capture(orderId);
    const member = await h.signIn(await h.seed.member());

    const result = await h
      .as(member)
      .receiveGatewayWebhook(capturedWebhook(h, orderId));

    expect(result).toEqual({ ok: true, outcome: "captured" });
  });

  it("is not for the platform's own processes, and stores nothing for them", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { orderId } = await openOrder(school);
    h.gateway.capture(orderId);
    const before = await paymentRows(h);
    const system: Actor = { kind: "system", process: "worker" };

    await expect(
      h.as(system).receiveGatewayWebhook(capturedWebhook(h, orderId))
    ).rejects.toThrow(DomainError);

    expect(await h.db.select().from(gatewayWebhookEvent)).toEqual([]);
    expect(await paymentRows(h)).toEqual(before);
  });

  it("rejects a signed body that was changed on the way", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { orderId } = await openOrder(school);
    const webhook = capturedWebhook(h, orderId);

    const result = await receive(h, {
      rawBody: webhook.rawBody.replace("payment.captured", "payment.failed"),
      headers: webhook.headers,
    });

    expect(result).toEqual({ ok: false, error: "rejected" });
  });

  it("waits while the gateway has captured nothing on the order", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { batchId, orderId } = await openOrder(school);
    h.gateway.fail(orderId);

    const result = await receive(
      h,
      h.gateway.webhook({ type: "payment.failed", orderId })
    );

    expect(result).toEqual({ ok: true, outcome: "awaiting_payment" });
    expect((await batchRow(h, batchId)).status).toBe("order_created");
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
  });

  it("ignores, but keeps, a webhook about an order that isn't ours", async () => {
    const h = await createHarness();

    const result = await receive(
      h,
      h.gateway.webhook({ type: "payment.captured", orderId: "order_other" })
    );

    expect(result).toEqual({ ok: true, outcome: "ignored" });
    expect(await h.db.select().from(gatewayWebhookEvent)).toMatchObject([
      { orderId: "order_other", outcome: "ignored" },
    ]);
  });

  it("confirms nothing when the captured amount isn't the batch's, records the mismatch and sends the batch to review (#79)", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const { paymentId } = h.gateway.capture(orderId, {
      amount: { amountMinor: 50_000n, currency: "INR" },
    });

    const result = await receive(h, capturedWebhook(h, orderId));

    expect(result).toEqual({ ok: true, outcome: "needs_review" });
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "needs_review",
      capturedAt: null,
    });
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
    expect(
      await h.db
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, batchId),
            eq(auditLog.action, "payment.amount_mismatch")
          )
        )
    ).toEqual([
      {
        action: "payment.amount_mismatch",
        after: {
          gatewayPaymentId: paymentId,
          capturedMinor: "50000",
          batchMinor: "100000",
        },
      },
    ]);
  });

  it("confirms nothing for money that reaches a cancelled batch, and sends it to review (#79)", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const first = await openOrder(school);
    // A student is added, so paying again replaces the first batch, which
    // the gateway says is unpaid. The payer pays its order only after that
    // (an old Checkout tab): money that goes to review (#79).
    school.registrationIds.push(await enrol(h, school, 2));
    await openOrder(school);
    h.gateway.capture(first.orderId);

    const result = await receive(h, capturedWebhook(h, first.orderId));

    expect(result).toEqual({ ok: true, outcome: "needs_review" });
    expect((await batchRow(h, first.batchId)).status).toBe("needs_review");
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled"]);
    expect(await h.db.select().from(gatewayWebhookEvent)).toMatchObject([
      { orderId: first.orderId, outcome: "needs_review" },
    ]);
  });

  it("writes the capture and each confirmation to the audit log, before and after", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const { paymentId } = h.gateway.capture(orderId);

    await receive(h, capturedWebhook(h, orderId));

    const captured = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "payment.batch_captured"));
    expect(captured).toEqual([
      expect.objectContaining({
        actorKind: "visitor",
        entityType: "payment_batch",
        entityId: batchId,
        before: { status: "order_created" },
        after: {
          status: "captured",
          captureMethod: "gateway",
          gatewayPaymentId: paymentId,
          capturedAt: h.clock.now().toISOString(),
          confirmed: 2,
          notConfirmed: [],
        },
      }),
    ]);
    const registrations = await registrationsOf(h, school.registrationIds);
    const confirmed = await h.db
      .select()
      .from(auditLog)
      .where(like(auditLog.action, "registration.confirmed"))
      .orderBy(auditLog.entityId);
    expect(confirmed).toEqual(
      registrations.map((row) =>
        expect.objectContaining({
          actorKind: "visitor",
          entityType: "registration",
          entityId: row.id,
          before: { status: "enrolled" },
          after: {
            status: "confirmed",
            registrationNumber: row.registrationNumber,
            batchId,
          },
        })
      )
    );
  });

  it("confirms nobody and sends the batch to review when a student was withdrawn after the order opened (#79)", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const [kept, withdrawn] = school.registrationIds as [string, string];
    await h.as(school.coordinator.actor).withdrawStudent({
      ...school.ids,
      registrationId: withdrawn,
    });
    h.gateway.capture(orderId);

    expect(await receive(h, capturedWebhook(h, orderId))).toEqual({
      ok: true,
      outcome: "needs_review",
    });

    expect((await registrationsOf(h, [kept])).map((r) => r.status)).toEqual([
      "enrolled",
    ]);
    expect(
      (await registrationsOf(h, [withdrawn])).map((r) => r.status)
    ).toEqual(["withdrawn"]);
    expect((await batchRow(h, batchId)).status).toBe("needs_review");
    expect(
      (await reviewCasesOf(h, batchId)).map((each) => each.reason)
    ).toEqual(["registration_cancelled"]);
  });
});
