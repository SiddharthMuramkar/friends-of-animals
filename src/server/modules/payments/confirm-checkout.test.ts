import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { outbox } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { REGISTRATION_NUMBER } from "@/server/modules/registration/domain/registration-number";
import { createHarness, type Harness } from "@/test/harness";

import {
  FEE_PAISE,
  paymentRows,
  registrationsOf,
  schoolWithStudents,
  type School,
} from "./testing";

async function openOrder(h: Harness, school: School) {
  const result = await school.pay();
  if (!result.ok || result.kind !== "checkout") {
    throw new Error(`No order: ${JSON.stringify(result)}`);
  }
  return { batchId: result.batchId, orderId: result.checkout.orderId };
}

/** What the browser posts back after Checkout, as the coordinator. */
function confirm(
  h: Harness,
  school: School,
  returned: { batchId: string; paymentId: string; signature: string },
  actor: Actor = school.coordinator.actor
) {
  return h.as(actor).confirmCheckout({
    institutionId: school.institutionId,
    ...returned,
  });
}

/** The payment.batch_captured events in the outbox, one per event. */
async function capturedEvents(h: Harness) {
  const rows = await h.db
    .select({ eventId: outbox.eventId })
    .from(outbox)
    .where(eq(outbox.eventType, "payment.batch_captured"));
  return new Set(rows.map((row) => row.eventId)).size;
}

describe("confirmCheckout", () => {
  it("confirms the batch's registrations when Checkout's signature is genuine", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(h, school);
    const returned = h.gateway.capture(orderId);

    const result = await confirm(h, school, { batchId, ...returned });

    expect(result).toEqual({ ok: true, outcome: "captured" });
    const registrations = await registrationsOf(h, school.registrationIds);
    expect(registrations.map((r) => r.status)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    for (const { registrationNumber } of registrations) {
      expect(registrationNumber).toMatch(REGISTRATION_NUMBER);
    }
  });

  it("refuses a signature that isn't genuine and changes nothing", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { batchId, orderId } = await openOrder(h, school);
    const { paymentId } = h.gateway.capture(orderId);
    const before = await paymentRows(h);

    const result = await confirm(h, school, {
      batchId,
      paymentId,
      signature: "0".repeat(64),
    });

    expect(result).toEqual({ ok: false, error: "invalid_signature" });
    expect(await paymentRows(h)).toEqual(before);
  });

  it("refuses a genuine signature for another order", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 1,
    });
    const mine = await openOrder(h, school);
    const theirs = await openOrder(h, other);
    const returned = h.gateway.capture(theirs.orderId);

    const result = await confirm(h, school, {
      batchId: mine.batchId,
      ...returned,
    });

    expect(result).toEqual({ ok: false, error: "invalid_signature" });
  });

  it.each([
    ["webhook first", ["webhook", "checkout"]],
    ["Checkout first", ["checkout", "webhook"]],
    ["each twice", ["checkout", "webhook", "checkout", "webhook"]],
  ] as const)(
    "confirms once whatever the order of the signals (%s)",
    async (_, signals) => {
      const h = await createHarness();
      const school = await schoolWithStudents(h, { students: 2 });
      const { batchId, orderId } = await openOrder(h, school);
      const returned = h.gateway.capture(orderId);
      const outcomes: string[] = [];
      let afterFirst: Awaited<ReturnType<typeof registrationsOf>> = [];

      for (const signal of signals) {
        const result =
          signal === "checkout"
            ? await confirm(h, school, { batchId, ...returned })
            : await h
                .as(h.visitor())
                .receiveGatewayWebhook(
                  h.gateway.webhook({ type: "payment.captured", orderId })
                );
        outcomes.push(result.ok ? result.outcome : result.error);
        if (outcomes.length === 1) {
          afterFirst = await registrationsOf(h, school.registrationIds);
        }
      }

      expect(outcomes).toEqual([
        "captured",
        ...signals.slice(1).map(() => "already_captured"),
      ]);
      expect(afterFirst.map((r) => r.status)).toEqual([
        "confirmed",
        "confirmed",
      ]);
      expect(await registrationsOf(h, school.registrationIds)).toEqual(
        afterFirst
      );
      expect(await capturedEvents(h)).toBe(1);
    }
  );

  it("lets the authorised person confirm, and refuses another institution's coordinator and a plain member", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 0,
    });
    const member = await h.signIn(await h.seed.member());
    const { batchId, orderId } = await openOrder(h, school);
    const returned = h.gateway.capture(orderId);

    await expect(
      confirm(h, school, { batchId, ...returned }, other.coordinator.actor)
    ).rejects.toThrow(DomainError);
    await expect(
      confirm(h, school, { batchId, ...returned }, member)
    ).rejects.toThrow(DomainError);
    expect(
      await confirm(
        h,
        school,
        { batchId, ...returned },
        await h.signIn(school.admin)
      )
    ).toEqual({ ok: true, outcome: "captured" });
  });

  it("finds no batch of another institution", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 1,
    });
    const theirs = await openOrder(h, other);
    const returned = h.gateway.capture(theirs.orderId);

    expect(
      await confirm(h, school, { batchId: theirs.batchId, ...returned })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("getPaymentBatch", () => {
  it("shows the coordinator the batch, its students and, once paid, their registration numbers", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(h, school);
    const read = () =>
      h.as(school.coordinator.actor).getPaymentBatch({
        institutionId: school.institutionId,
        batchId,
      });

    const open = await read();
    expect(open).toMatchObject({
      ok: true,
      batch: {
        id: batchId,
        status: "order_created",
        amount: { amountMinor: 2n * FEE_PAISE, currency: "INR" },
        reference: school.reference,
        competition: { code: "PAWS27", name: "Paws on the Pavement" },
        capturedAt: null,
        checkout: { orderId, gateway: "fake" },
      },
    });
    expect(open.ok && open.batch.items).toEqual([
      {
        registrationId: expect.any(String),
        fullName: "Student A Rao",
        amountMinor: FEE_PAISE,
        status: "enrolled",
        registrationNumber: null,
      },
      {
        registrationId: expect.any(String),
        fullName: "Student B Rao",
        amountMinor: FEE_PAISE,
        status: "enrolled",
        registrationNumber: null,
      },
    ]);

    await confirm(h, school, { batchId, ...h.gateway.capture(orderId) });
    const paid = await read();
    expect(paid).toMatchObject({
      ok: true,
      batch: { status: "captured", capturedAt: h.clock.now(), checkout: null },
    });
    expect(
      paid.ok &&
        paid.batch.items.map((item) => [item.status, item.registrationNumber])
    ).toEqual([
      ["confirmed", expect.stringMatching(REGISTRATION_NUMBER)],
      ["confirmed", expect.stringMatching(REGISTRATION_NUMBER)],
    ]);
  });

  it("refuses another institution's coordinator and a plain member, and finds nothing it doesn't hold", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 0,
    });
    const member = await h.signIn(await h.seed.member());
    const { batchId } = await openOrder(h, school);
    const input = { institutionId: school.institutionId, batchId };

    await expect(
      h.as(other.coordinator.actor).getPaymentBatch(input)
    ).rejects.toThrow(DomainError);
    await expect(h.as(member).getPaymentBatch(input)).rejects.toThrow(
      DomainError
    );
    expect(
      await h.as(other.coordinator.actor).getPaymentBatch({
        institutionId: other.institutionId,
        batchId,
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(school.coordinator.actor).getPaymentBatch({
        ...input,
        batchId: "01938a00-0000-7000-8000-00000000ffff",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
