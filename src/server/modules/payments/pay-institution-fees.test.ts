import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, paymentBatch, paymentBatchItem } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import {
  batchRow,
  FEE_PAISE,
  registrationsOf,
  schoolWithStudents,
} from "./testing";

describe("payInstitutionFees", () => {
  it("opens one gateway order for the sum of every unpaid student's fee, with one batch item per registration", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });

    const result = await school.pay();

    expect(result).toMatchObject({ ok: true, kind: "checkout" });
    if (!result.ok || result.kind !== "checkout") return;
    expect(h.gateway.orders).toEqual([
      {
        orderId: result.checkout.orderId,
        amount: { amountMinor: 3n * FEE_PAISE, currency: "INR" },
        receipt: result.batchId,
        notes: { batchId: result.batchId, reference: school.reference },
      },
    ]);
    expect(result.checkout).toEqual({
      gateway: "fake",
      orderId: result.checkout.orderId,
      amount: { amountMinor: 150_000n, currency: "INR" },
      description: `Fees for 3 students in Paws on the Pavement (${school.reference})`,
      publicKey: null,
    });
    expect(await batchRow(h, result.batchId)).toMatchObject({
      route: "institution",
      institutionId: school.institutionId,
      institutionRegistrationId: school.registrationId,
      competitionId: school.competition.id,
      payerUserId: school.coordinator.userId,
      status: "order_created",
      amountMinor: 150_000n,
      currency: "INR",
      gateway: "fake",
      gatewayOrderId: result.checkout.orderId,
      capturedAt: null,
    });
    const items = await h.db
      .select()
      .from(paymentBatchItem)
      .where(eq(paymentBatchItem.batchId, result.batchId));
    expect(
      items.map(({ registrationId, amountMinor, releasedAt }) => ({
        registrationId,
        amountMinor,
        releasedAt,
      }))
    ).toEqual(
      school.registrationIds.toSorted().map((registrationId) => ({
        registrationId,
        amountMinor: FEE_PAISE,
        releasedAt: null,
      }))
    );
    // Nobody is confirmed until the gateway says the money arrived.
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["enrolled", "enrolled", "enrolled"]);
  });

  it("records who opened the batch in the audit log", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });

    const result = await school.pay();
    if (!result.ok || result.kind !== "checkout") throw new Error("no order");

    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.batchId));
    expect(entries).toEqual([
      expect.objectContaining({
        action: "payment.batch_created",
        entityType: "payment_batch",
        actorUserId: school.coordinator.userId,
        actorRole: "institution_coordinator",
        before: null,
        after: {
          status: "order_created",
          amountMinor: "100000",
          registrationIds: school.registrationIds.toSorted(),
          gatewayOrderId: result.checkout.orderId,
        },
      }),
    ]);
  });

  it("lets the institution's authorised person pay too", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const admin = await h.signIn(school.admin);

    expect(await school.pay(admin)).toMatchObject({
      ok: true,
      kind: "checkout",
    });
  });

  it("refuses another institution's coordinator and a plain member", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 0,
    });
    const member = await h.signIn(await h.seed.member());

    await expect(school.pay(other.coordinator.actor)).rejects.toThrow(
      DomainError
    );
    await expect(school.pay(member)).rejects.toThrow(DomainError);
    expect(h.gateway.orders).toEqual([]);
    expect(await h.db.select().from(paymentBatch)).toEqual([]);
  });

  it("refuses a reference that isn't the institution's own, as not found", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 1,
    });

    const result = await h.as(school.coordinator.actor).payInstitutionFees({
      institutionId: school.institutionId,
      reference: other.reference,
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("asks for nothing while the competition's institution fee isn't set", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { feePaise: null });

    expect(await school.pay()).toEqual({ ok: false, error: "fee_not_set" });
    expect(h.gateway.orders).toEqual([]);
  });

  it("has nothing to pay once no student is waiting for payment", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 0 });

    expect(await school.pay()).toEqual({ ok: false, error: "nothing_to_pay" });
  });

  it("fails the batch and lets its students go when the gateway refuses the order", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    h.gateway.refuseNextOrder();

    const refused = await school.pay();

    expect(refused).toEqual({ ok: false, error: "gateway_unavailable" });
    const [failed] = await h.db.select().from(paymentBatch);
    expect(failed).toMatchObject({ status: "failed", gatewayOrderId: null });
    expect(
      (await h.db.select().from(paymentBatchItem)).map((item) => item.releasedAt)
    ).toEqual([h.clock.now(), h.clock.now()]);

    // Trying again opens a new batch over the same students.
    const again = await school.pay();
    expect(again).toMatchObject({ ok: true, kind: "checkout" });
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("checks its input", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 0 });

    const result = await h.as(school.coordinator.actor).payInstitutionFees({
      institutionId: school.institutionId,
      reference: "x".repeat(41),
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
  });
});
