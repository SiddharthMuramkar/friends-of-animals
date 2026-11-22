import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, outbox, paymentBatch, user } from "@/server/db/schema";
import { REGISTRATION_NUMBER } from "@/server/modules/registration/domain/registration-number";
import { createHarness, type Harness } from "@/test/harness";

import {
  batchRow,
  closeRegistration,
  guardianEmail,
  offlinePaymentOf,
  openOrder,
  paymentRows,
  registrationsOf,
  schoolWithStudents,
  signInStaff,
  uploadProof,
  type PaymentsStaffRole,
  type School,
} from "./testing";

// #79: finance records a cheque, bank transfer or cash against a payment
// batch, with a private proof file. It has the effect of an online capture.

/** A school of two at ₹500 each with an open order: a ₹1,000 batch. */
async function openBatch(h: Harness) {
  const school = await schoolWithStudents(h, { students: 2 });
  const { batchId, orderId } = await openOrder(school);
  return { school, batchId, orderId };
}

/** A cheque for the whole ₹1,000, received yesterday (IST), with proof. */
function cheque(batchId: string, proofFileId: string) {
  return {
    batchId,
    method: "cheque",
    reference: " 004 512 ",
    amount: "1,000",
    receivedOn: "2027-01-14",
    proofFileId,
  };
}

async function recordCheque(
  h: Harness,
  actor: Actor,
  batchId: string,
  overrides: Partial<ReturnType<typeof cheque>> = {}
) {
  const proofFileId = await uploadProof(h, actor, batchId);
  return h
    .as(actor)
    .recordOfflinePayment({ ...cheque(batchId, proofFileId), ...overrides });
}

async function coordinatorEmail(h: Harness, school: School) {
  const [row] = await h.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, school.coordinator.userId));
  return row?.email;
}

describe("recordOfflinePayment", () => {
  it("captures the batch offline and confirms each registration with its number, in one go", async () => {
    const h = await createHarness();
    const { school, batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);

    const result = await h
      .as(finance.actor)
      .recordOfflinePayment(cheque(batchId, proofFileId));

    expect(result).toEqual({ ok: true, batchId, confirmed: 2 });
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "captured",
      captureMethod: "offline",
      capturedAt: h.clock.now(),
      gatewayPaymentId: null,
    });
    expect(await offlinePaymentOf(h, batchId)).toMatchObject({
      method: "cheque",
      reference: "004512",
      amountMinor: 100_000n,
      receivedOn: "2027-01-14",
      proofFileAssetId: proofFileId,
      recordedByUserId: finance.userId,
      recordedAt: h.clock.now(),
    });
    const registrations = await registrationsOf(h, school.registrationIds);
    expect(registrations.map((row) => row.status)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    for (const row of registrations) {
      expect(row.registrationNumber).toMatch(REGISTRATION_NUMBER);
    }

    const events = await h.db
      .selectDistinct({ eventId: outbox.eventId, type: outbox.eventType })
      .from(outbox)
      .where(
        inArray(outbox.eventType, [
          "payment.batch_captured",
          "registration.confirmed",
        ])
      );
    expect(events.map((event) => event.type).toSorted()).toEqual([
      "payment.batch_captured",
      "registration.confirmed",
      "registration.confirmed",
    ]);

    const audit = await h.db
      .select({
        action: auditLog.action,
        actorRole: auditLog.actorRole,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(
        inArray(auditLog.action, [
          "payment.offline_recorded",
          "payment.batch_captured",
          "registration.confirmed",
        ])
      )
      .orderBy(auditLog.id);
    expect(audit.map((row) => [row.action, row.actorRole])).toEqual([
      ["payment.offline_recorded", "finance"],
      ["registration.confirmed", "finance"],
      ["registration.confirmed", "finance"],
      ["payment.batch_captured", "finance"],
    ]);
    expect(audit[0]?.after).toEqual({
      batchId,
      method: "cheque",
      amountMinor: "100000",
      receivedOn: "2027-01-14",
      proofFileId,
    });
    expect(audit[3]?.after).toMatchObject({
      status: "captured",
      captureMethod: "offline",
      confirmed: 2,
    });
  });

  it("sends the payer a receipt naming the cheque, and each family its student's number", async () => {
    const h = await createHarness();
    const { school, batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    await recordCheque(h, finance.actor, batchId);
    const mark = h.email.sent.length;

    await h.drain();

    const sent = h.email.sent.slice(mark);
    const receipt = sent.find((each) =>
      each.subject.startsWith("Payment received")
    );
    expect(receipt?.to).toBe(await coordinatorEmail(h, school));
    expect(receipt?.text).toContain("₹1,000.00");
    expect(receipt?.text).toContain("004512");
    for (const n of [1, 2]) {
      expect(h.email.lastTo(guardianEmail(n))?.subject).toMatch(
        /is registered for Paws on the Pavement$/
      );
    }
  });

  it("takes a batch whose gateway order was never opened", async () => {
    const h = await createHarness();
    const { school, batchId } = await openBatch(h);
    // The order request never came back: the batch is still `created`.
    await h.db
      .update(paymentBatch)
      .set({ status: "created", gatewayOrderId: null })
      .where(eq(paymentBatch.id, batchId));
    const finance = await signInStaff(h, "finance");

    const result = await recordCheque(h, finance.actor, batchId);

    expect(result).toEqual({ ok: true, batchId, confirmed: 2 });
    expect(await batchRow(h, batchId)).toMatchObject({
      status: "captured",
      captureMethod: "offline",
      gatewayOrderId: null,
    });
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["confirmed", "confirmed"]);
  });

  it("takes money that arrived after the competition stopped taking registrations", async () => {
    const h = await createHarness();
    const { school, batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    await closeRegistration(h, school);

    const result = await recordCheque(h, finance.actor, batchId);

    expect(result).toMatchObject({ ok: true, confirmed: 2 });
  });

  it.each([
    [
      "a bank transfer",
      "bank_transfer",
      "axis-2027 0114-5555",
      "AXIS202701145555",
    ],
    ["cash", "cash", "foa/2027/0012", "FOA/2027/0012"],
  ])(
    "records %s with its reference as stored",
    async (_name, method, reference, stored) => {
      const h = await createHarness();
      const { batchId } = await openBatch(h);
      const finance = await signInStaff(h, "finance");

      const result = await recordCheque(h, finance.actor, batchId, {
        method,
        reference,
      });

      expect(result).toMatchObject({ ok: true });
      expect(await offlinePaymentOf(h, batchId)).toMatchObject({
        method,
        reference: stored,
      });
    }
  );
});

describe("recordOfflinePayment refusals", () => {
  it("reports every wrong field at once, and writes nothing", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);
    const before = await paymentRows(h);

    const result = await h.as(finance.actor).recordOfflinePayment({
      ...cheque(batchId, proofFileId),
      reference: "4512",
      amount: "999.99",
      receivedOn: "2027-01-16",
    });

    expect(result).toEqual({
      ok: false,
      error: "fields_invalid",
      errors: {
        reference: "reference_invalid",
        amountMinor: "amount_mismatch",
        receivedOn: "received_in_future",
      },
    });
    expect(await paymentRows(h)).toEqual(before);
  });

  it.each([
    ["nothing", "", "amount_invalid"],
    ["zero", "0", "amount_invalid"],
    ["words", "one thousand", "amount_invalid"],
  ])("refuses an amount of %s", async (_name, amount, error) => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");

    expect(
      await recordCheque(h, finance.actor, batchId, { amount })
    ).toMatchObject({ ok: false, errors: { amountMinor: error } });
  });

  it("refuses a date that isn't one, or is over a year old", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");

    expect(
      await recordCheque(h, finance.actor, batchId, {
        receivedOn: "2027-02-30",
      })
    ).toMatchObject({ errors: { receivedOn: "received_on_invalid" } });
    expect(
      await recordCheque(h, finance.actor, batchId, {
        receivedOn: "2026-01-13",
      })
    ).toMatchObject({ errors: { receivedOn: "received_too_long_ago" } });
  });

  it("records a double submit once: the second finds the batch paid", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);
    const input = cheque(batchId, proofFileId);

    const [first, second] = await Promise.all([
      h.as(finance.actor).recordOfflinePayment(input),
      h.as(finance.actor).recordOfflinePayment(input),
    ]);

    expect([first, second]).toContainEqual({
      ok: false,
      error: "already_paid",
    });
    expect([first, second]).toContainEqual({ ok: true, batchId, confirmed: 2 });
    expect((await paymentRows(h)).offlinePayments).toHaveLength(1);
  });

  it.each(["failed", "cancelled", "needs_review"] as const)(
    "refuses a %s batch",
    async (status) => {
      const h = await createHarness();
      const { batchId } = await openBatch(h);
      await h.db
        .update(paymentBatch)
        .set({ status })
        .where(eq(paymentBatch.id, batchId));
      const finance = await signInStaff(h, "finance");

      expect(await recordCheque(h, finance.actor, batchId)).toEqual({
        ok: false,
        error: "batch_not_payable",
      });
      expect(await offlinePaymentOf(h, batchId)).toBeNull();
    }
  );

  it("refuses a batch with a registration that was withdrawn", async () => {
    const h = await createHarness();
    const { school, batchId } = await openBatch(h);
    await h.as(school.coordinator.actor).withdrawStudent({
      ...school.ids,
      registrationId: school.registrationIds[0]!,
    });
    const finance = await signInStaff(h, "finance");

    expect(await recordCheque(h, finance.actor, batchId)).toEqual({
      ok: false,
      error: "registration_not_payable",
    });
  });

  it("refuses a batch that doesn't exist", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);

    expect(
      await h.as(finance.actor).recordOfflinePayment({
        ...cheque(batchId, proofFileId),
        batchId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a proof another finance user uploaded, or one that failed its scan", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const colleague = await signInStaff(h, "finance");
    const theirs = await uploadProof(h, colleague.actor, batchId);
    const flagged = await uploadProof(h, finance.actor, batchId, "quarantined");

    for (const proofFileId of [theirs, flagged]) {
      expect(
        await h
          .as(finance.actor)
          .recordOfflinePayment(cheque(batchId, proofFileId))
      ).toEqual({ ok: false, error: "proof_invalid" });
    }
    expect(await offlinePaymentOf(h, batchId)).toBeNull();
  });

  it("refuses a file uploaded for something else", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const upload = await h.as(finance.actor).requestUpload({
      purpose: "test_upload",
      contentType: "application/pdf",
      sizeBytes: 10,
    });
    if (!upload.ok) throw new Error("no upload");

    expect(
      await h
        .as(finance.actor)
        .recordOfflinePayment(cheque(batchId, upload.fileId))
    ).toEqual({ ok: false, error: "proof_invalid" });
  });
});

describe("who may record an offline payment", () => {
  it.each<PaymentsStaffRole>(["finance", "staff_admin", "super_admin"])(
    "a %s may",
    async (role) => {
      const h = await createHarness();
      const { batchId } = await openBatch(h);
      const staff = await signInStaff(h, role);

      expect(await recordCheque(h, staff.actor, batchId)).toMatchObject({
        ok: true,
      });
    }
  );

  it.each<[string, (h: Harness, school: School) => Promise<Actor>]>([
    [
      "the batch's own coordinator",
      async (_h, school) => school.coordinator.actor,
    ],
    [
      "a competition manager",
      async (h) => (await signInStaff(h, "competition_manager")).actor,
    ],
    ["a member", async (h) => (await signInStaff(h, null)).actor],
    ["a visitor", async (h) => h.visitor()],
  ])("%s may not, and nothing is written", async (_who, who) => {
    const h = await createHarness();
    const { school, batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);
    const actor = await who(h, school);
    const before = await paymentRows(h);

    await expect(
      h.as(actor).recordOfflinePayment(cheque(batchId, proofFileId))
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(actor).requestOfflinePaymentProofUpload({
        batchId,
        contentType: "application/pdf",
        sizeBytes: 100,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await paymentRows(h)).toEqual(before);
  });

  it("needs a second factor passed in the last 10 minutes: money moves", async () => {
    const h = await createHarness();
    const { batchId } = await openBatch(h);
    const finance = await signInStaff(h, "finance");
    const proofFileId = await uploadProof(h, finance.actor, batchId);
    h.clock.advance({ minutes: 10, seconds: 1 });
    const before = await paymentRows(h);

    await expect(
      h.as(finance.actor).recordOfflinePayment(cheque(batchId, proofFileId))
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await paymentRows(h)).toEqual(before);

    await h.passSecondFactor(finance.actor);
    expect(
      await h
        .as(finance.actor)
        .recordOfflinePayment(cheque(batchId, proofFileId))
    ).toMatchObject({ ok: true });
  });
});
