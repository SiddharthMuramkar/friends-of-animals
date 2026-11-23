import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, user } from "@/server/db/schema";
import {
  childForm,
  consentCompetition,
} from "@/server/modules/consent/testing";
import { createHarness, type Harness } from "@/test/harness";

import { signInStaff } from "../testing";
import {
  capturedBatch,
  REASON,
  refundRow,
  type CapturedBatch,
} from "./testing";

// #80 slice 5 (messages): once a refund's money is back, whoever paid the
// batch is told, by email and in the app (refund.processed, emitted in
// the transaction that marks it refunded). When the gateway fails one,
// the finance team is told (refund.failed).

async function approvedRefund(
  h: Harness,
  paid: Pick<CapturedBatch, "batchId">
) {
  const staff = await signInStaff(h, "staff_admin");
  const asked = await h
    .as(staff.actor)
    .requestRefund({ batchId: paid.batchId, reason: REASON });
  if (!asked.ok) throw new Error(JSON.stringify(asked));
  const finance = await signInStaff(h, "finance");
  await h.as(finance.actor).approveRefund({ refundId: asked.refundId });
  return { refundId: asked.refundId, finance };
}

async function emailOf(h: Harness, userId: string) {
  const [row] = await h.db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row!.email;
}

describe("refund messages", () => {
  it("emits refund.processed with the refund, and tells the payer by email and in the app", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h, { students: 2 });
    const { refundId } = await approvedRefund(h, paid);
    const mark = h.email.sent.length;

    await h.drain();

    expect((await refundRow(h, refundId)).status).toBe("refunded");
    const [event] = await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "refund.processed"));
    expect(event).toMatchObject({
      aggregateType: "refund",
      aggregateId: refundId,
      payload: { refundId, payerUserId: paid.school.coordinator.userId },
    });
    const notice = h.email.sent
      .slice(mark)
      .find((each) => each.subject.startsWith("Refund of"));
    expect(notice).toMatchObject({
      to: await emailOf(h, paid.school.coordinator.userId),
      subject: "Refund of ₹1,000.00 for Paws on the Pavement",
    });
    expect(notice?.text).toContain(h.gateway.refunds[0]!.id);

    const inbox = await h.as(paid.school.coordinator.actor).listInbox();
    expect(inbox).toContainEqual(
      expect.objectContaining({
        title: "Refund of ₹1,000.00 for Paws on the Pavement",
      })
    );
  });

  it("tells the finance team when the gateway fails a refund", async () => {
    const h = await createHarness();
    const paid = await capturedBatch(h);
    const { finance } = await approvedRefund(h, paid);
    h.gateway.answerNextRefund("failed");

    await h.drain();

    expect(await h.as(finance.actor).listInbox()).toContainEqual(
      expect.objectContaining({ title: "A refund of ₹1,000.00 failed" })
    );
  });

  it("routes confirmation, receipt and refund to the guardian who paid for their teen", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, {
      name: "Art for Animals",
    });
    const teen = await h.seed.member({ name: "Asha Kulkarni" });
    const family = await h.seed.guardian({
      children: [{ fullName: teen.name, age: 15, loginUserId: teen.id }],
    });
    const parent = h.as(await h.signIn(family.account));
    const child = h.as(await h.signIn(teen));
    const registration = await parent.registerAsIndividual(
      childForm(competition, family.childIds[0]!, { participation: true })
    );
    if (!registration.ok) throw new Error(JSON.stringify(registration));
    const paid = await parent.payForMyRegistration({
      registrationId: registration.registrationId,
    });
    if (!paid.ok || paid.kind !== "checkout")
      throw new Error("Expected checkout");
    const orderId = paid.checkout.orderId;
    h.gateway.capture(orderId);
    const webhook = await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "payment.captured", orderId })
      );
    expect(webhook).toMatchObject({ ok: true, outcome: "captured" });

    const { refundId } = await approvedRefund(h, paid);
    await h.drain();
    expect((await refundRow(h, refundId)).status).toBe("refunded");
    const subjects = [
      "Asha Kulkarni is registered for Art for Animals",
      "Payment received for Art for Animals",
      "Refund of ₹250.00 for Art for Animals",
    ];
    for (const subject of subjects) {
      expect(h.email.sent.filter((mail) => mail.subject === subject)).toEqual([
        expect.objectContaining({ to: family.account.email }),
      ]);
    }
    const parentTitles = (await parent.listInbox()).map(({ title }) => title);
    const childTitles = (await child.listInbox()).map(({ title }) => title);
    expect(parentTitles).toEqual(expect.arrayContaining(subjects));
    expect(childTitles).toContain(subjects[0]);
    expect(childTitles).not.toContain(subjects[1]);
    expect(childTitles).not.toContain(subjects[2]);
  });
});
