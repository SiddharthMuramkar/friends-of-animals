import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messageRoute, outbox, paymentBatch, user } from "@/server/db/schema";
import { REGISTRATION_NUMBER } from "@/server/modules/registration/domain/registration-number";
import { createHarness, type Harness } from "@/test/harness";

import {
  guardianEmail,
  registrationsOf,
  schoolWithStudents,
  type School,
} from "./testing";

async function payAndCapture(h: Harness, school: School) {
  const result = await school.pay();
  if (!result.ok || result.kind !== "checkout") throw new Error("no order");
  const { orderId } = result.checkout;
  await h.as(school.coordinator.actor).confirmCheckout({
    institutionId: school.institutionId,
    batchId: result.batchId,
    ...h.gateway.capture(orderId),
  });
  return result;
}

async function coordinatorEmail(h: Harness, school: School) {
  const [row] = await h.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, school.coordinator.userId));
  return row?.email;
}

describe("payment messages", () => {
  it("writes the receipt and one confirmation per registration to the outbox in the capture", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });

    await payAndCapture(h, school);

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
      "registration.confirmed",
    ]);
  });

  it("sends the payer a receipt and each family its student's registration number", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    await payAndCapture(h, school);
    const mark = h.email.sent.length;

    await h.drain();

    const sent = h.email.sent.slice(mark);
    const receipt = sent.find((each) =>
      each.subject.startsWith("Payment received")
    );
    expect(receipt).toMatchObject({
      subject: "Payment received for Paws on the Pavement",
    });
    expect(receipt?.to).toBe(await coordinatorEmail(h, school));
    expect(receipt?.text).toContain("₹1,000.00");
    expect(receipt?.text).toContain("2 students");
    expect(receipt?.text).toContain(school.reference);

    const registrations = await registrationsOf(h, school.registrationIds);
    for (const [n, name] of [
      [1, "Student A Rao"],
      [2, "Student B Rao"],
    ] as const) {
      const message = h.email.lastTo(guardianEmail(n));
      expect(message?.subject).toBe(
        `${name} is registered for Paws on the Pavement`
      );
      expect(message?.text).toContain("Hello Kavita Rao,");
      const number = message?.text.match(/[A-Z]{3,6}\d{2}-R-[0-9A-Z]{6}/)?.[0];
      expect(number).toMatch(REGISTRATION_NUMBER);
      expect(registrations.map((r) => r.registrationNumber)).toContain(number);
    }
    // One message per family, however often the outbox ran.
    expect(sent.filter((each) => each.to.startsWith("guardian-"))).toHaveLength(
      2
    );
  });

  it("confirms a free competition's registrations at once, with no order, and tells each family", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2, feePaise: 0n });

    const result = await school.pay();

    expect(result).toEqual({ ok: true, kind: "confirmed_free", confirmed: 2 });
    expect(h.gateway.orders).toEqual([]);
    expect(await h.db.select().from(paymentBatch)).toEqual([]);
    const registrations = await registrationsOf(h, school.registrationIds);
    expect(registrations.map((r) => r.status)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    for (const { registrationNumber } of registrations) {
      expect(registrationNumber).toMatch(REGISTRATION_NUMBER);
    }

    await h.drain();
    expect(h.email.lastTo(guardianEmail(1))?.subject).toBe(
      "Student A Rao is registered for Paws on the Pavement"
    );
    expect(
      h.email.sent.filter((each) => each.subject.startsWith("Payment received"))
    ).toEqual([]);
  });

  it("tells nobody while the family confirmation route is switched off", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 1, feePaise: 0n });
    await h.db
      .update(messageRoute)
      .set({ enabled: false })
      .where(eq(messageRoute.eventType, "registration.confirmed"));

    await school.pay();
    await h.drain();

    expect(h.email.lastTo(guardianEmail(1))).toBeUndefined();
  });
});
