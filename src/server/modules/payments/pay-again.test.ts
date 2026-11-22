import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  PAYMENT_BATCH_ITEM_HOLDING_UNIQUE,
  paymentBatch,
  paymentBatchItem,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { isUniqueViolation } from "@/server/modules/codes/codes";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchRow,
  enrol,
  FEE_PAISE,
  openOrder,
  registrationsOf,
  schoolWithStudents,
  setInstitutionFee,
} from "./testing";

async function itemsOf(h: Harness, batchId: string) {
  return h.db
    .select({
      registrationId: paymentBatchItem.registrationId,
      releasedAt: paymentBatchItem.releasedAt,
    })
    .from(paymentBatchItem)
    .where(eq(paymentBatchItem.batchId, batchId))
    .orderBy(paymentBatchItem.registrationId);
}

describe("paying again", () => {
  it("reuses the open order while the same students wait to be paid", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const first = await openOrder(school);

    const again = await openOrder(school);

    expect(again).toEqual(first);
    expect(h.gateway.orders).toHaveLength(1);
    expect(await h.db.select().from(paymentBatch)).toHaveLength(1);
  });

  it("replaces the open batch when a student was added, letting its students go", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const first = await openOrder(school);
    school.registrationIds.push(await enrol(h, school, 2));
    h.clock.advance({ minutes: 3 });

    const second = await openOrder(school);

    expect(second.batchId).not.toBe(first.batchId);
    expect(await batchRow(h, first.batchId)).toMatchObject({
      status: "cancelled",
    });
    expect(await itemsOf(h, first.batchId)).toEqual([
      { registrationId: school.registrationIds[0], releasedAt: h.clock.now() },
    ]);
    expect(await itemsOf(h, second.batchId)).toEqual(
      school.registrationIds
        .toSorted()
        .map((registrationId) => ({ registrationId, releasedAt: null }))
    );
    expect(h.gateway.orders.map((order) => order.amount.amountMinor)).toEqual([
      FEE_PAISE,
      2n * FEE_PAISE,
    ]);
    expect(
      await h.db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.action, "payment.batch_cancelled"))
    ).toEqual([
      { before: { status: "order_created" }, after: { status: "cancelled" } },
    ]);
  });

  it("replaces the open batch when a student was withdrawn", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const first = await openOrder(school);
    const [kept, withdrawn] = school.registrationIds as [string, string];
    await h.as(school.coordinator.actor).withdrawStudent({
      ...school.ids,
      registrationId: withdrawn,
    });

    const second = await openOrder(school);

    expect((await batchRow(h, first.batchId)).status).toBe("cancelled");
    expect(await itemsOf(h, second.batchId)).toEqual([
      { registrationId: kept, releasedAt: null },
    ]);
    expect(h.gateway.orders.at(-1)?.amount.amountMinor).toBe(FEE_PAISE);
  });

  it("replaces the open batch when the fee changed", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const first = await openOrder(school);
    await setInstitutionFee(h, school, 60_000n);

    const second = await openOrder(school);

    expect(second.batchId).not.toBe(first.batchId);
    expect((await batchRow(h, second.batchId)).amountMinor).toBe(120_000n);
  });

  it("has nothing left to pay once the batch is captured", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { batchId, orderId } = await openOrder(school);
    await h.as(school.coordinator.actor).confirmCheckout({
      institutionId: school.institutionId,
      batchId,
      ...h.gateway.capture(orderId),
    });

    expect(await school.pay()).toEqual({ ok: false, error: "nothing_to_pay" });
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("captures an order that was paid before replacing it, and charges only the students still unpaid", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const first = await openOrder(school);
    // Paid at the gateway, but neither the Checkout return nor the
    // webhook has arrived yet.
    const { paymentId } = h.gateway.capture(first.orderId);
    const added = await enrol(h, school, 3);

    const second = await openOrder(school);

    expect(await batchRow(h, first.batchId)).toMatchObject({
      status: "captured",
      gatewayPaymentId: paymentId,
    });
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["confirmed", "confirmed"]);
    expect(await itemsOf(h, second.batchId)).toEqual([
      { registrationId: added, releasedAt: null },
    ]);
    expect(h.gateway.orders.map((order) => order.amount.amountMinor)).toEqual([
      2n * FEE_PAISE,
      FEE_PAISE,
    ]);
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "payment.batch_cancelled"))
    ).toEqual([]);

    // The late webhook for the first order then changes nothing.
    const late = await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "payment.captured", orderId: first.orderId })
      );
    expect(late).toEqual({ ok: true, outcome: "already_captured" });
  });

  it("has nothing left to pay, rather than the same order again, once that order was paid", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    h.gateway.capture(orderId);

    const again = await school.pay();

    expect(again).toEqual({ ok: false, error: "nothing_to_pay" });
    expect((await batchRow(h, batchId)).status).toBe("captured");
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["confirmed", "confirmed"]);
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("keeps the open order while the gateway can't say whether it was paid", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const first = await openOrder(school);
    school.registrationIds.push(await enrol(h, school, 2));
    h.gateway.failNextFetch();

    const result = await school.pay();

    expect(result).toEqual({ ok: false, error: "gateway_unavailable" });
    expect((await batchRow(h, first.batchId)).status).toBe("order_created");
    expect(await itemsOf(h, first.batchId)).toEqual([
      { registrationId: school.registrationIds[0], releasedAt: null },
    ]);
    expect(h.gateway.orders).toHaveLength(1);
    expect(h.errors.reported).toEqual([
      expect.objectContaining({
        tags: expect.objectContaining({ gateway: "fake" }),
      }),
    ]);

    // Once the gateway answers again, paying replaces the unpaid order.
    const again = await openOrder(school);
    expect((await batchRow(h, first.batchId)).status).toBe("cancelled");
    expect(await itemsOf(h, again.batchId)).toHaveLength(2);
  });

  it("lets only one batch at a time hold a registration", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1 });
    const { batchId } = await openOrder(school);
    const held = await batchRow(h, batchId);
    const now = h.clock.now();
    const other = uuidv7(now);
    await h.db.insert(paymentBatch).values({
      ...held,
      id: other,
      status: "created",
      gatewayOrderId: null,
    });

    const error = await h.db
      .insert(paymentBatchItem)
      .values({
        batchId: other,
        registrationId: school.registrationIds[0]!,
        amountMinor: FEE_PAISE,
      })
      .then(
        () => null,
        (caught: unknown) => caught
      );

    expect(isUniqueViolation(error, PAYMENT_BATCH_ITEM_HOLDING_UNIQUE)).toBe(
      true
    );
    // Once the first batch lets it go, another may hold it.
    await h.db
      .update(paymentBatchItem)
      .set({ releasedAt: now })
      .where(eq(paymentBatchItem.batchId, batchId));
    await h.db.insert(paymentBatchItem).values({
      batchId: other,
      registrationId: school.registrationIds[0]!,
      amountMinor: FEE_PAISE,
    });
  });
});
