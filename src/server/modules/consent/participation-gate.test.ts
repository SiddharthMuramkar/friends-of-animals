import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { auditLog, paymentBatch } from "@/server/db/schema";
import { adultForm, signInMember } from "@/server/modules/participants/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  childForm,
  consentCompetition,
  consentRows,
  guardianWithChild,
  publishNextVersion,
  reattach,
  statusOf,
} from "./testing";

// #82: a minor's registration can't be paid for or confirmed without their
// guardian's participation consent, given on the competition's attached
// version. A guardian registering their child gives it on the form; a
// registration without it is held, and giving it releases the
// registration in the same transaction.

async function giveParticipation(
  h: Harness,
  child: Awaited<ReturnType<typeof guardianWithChild>>,
  competition: Awaited<ReturnType<typeof consentCompetition>>,
  documentId = competition.guardianDocuments.participation!
) {
  return h.as(child.actor).giveChildConsent({
    childId: child.childId,
    competitionId: competition.id,
    purpose: "participation",
    documentId,
  });
}

describe("a guardian registering their child", () => {
  it("waits for payment when they give participation on the form, recorded in the same transaction", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const { account, childIds } = await h.seed.guardian({
      children: [{ fullName: "Asha Kulkarni", age: 9 }],
    });
    const actor = await h.signIn(account);
    const at = h.clock.now();

    const registered = await h
      .as(actor)
      .registerAsIndividual(
        childForm(competition, childIds[0]!, { participation: true })
      );

    expect(registered).toMatchObject({
      ok: true,
      status: "pending_payment",
      payNow: true,
    });
    expect((await consentRows(h)).events).toEqual([
      expect.objectContaining({
        subjectType: "participant_profile",
        subjectId: childIds[0],
        giverUserId: account.id,
        purpose: "participation",
        competitionId: competition.id,
        documentId: competition.guardianDocuments.participation,
        action: "given",
        method: "web_form",
        occurredAt: at,
      }),
    ]);
  });

  it("holds the registration without it, and giving it releases the registration, audited", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    expect(await statusOf(h, child.registrationId)).toBe("pending_guardian");
    expect(
      await h
        .as(child.actor)
        .payForMyRegistration({ registrationId: child.registrationId })
    ).toEqual({ ok: false, error: "awaiting_guardian" });

    expect(await giveParticipation(h, child, competition)).toEqual({
      ok: true,
      changed: true,
    });

    expect(await statusOf(h, child.registrationId)).toBe("pending_payment");
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, child.registrationId),
          eq(auditLog.action, "registration.status_changed")
        )
      );
    expect(audit).toMatchObject([
      {
        actorUserId: child.userId,
        actorRole: "guardian",
        before: { status: "pending_guardian" },
        after: { status: "pending_payment", cause: "guardian" },
      },
    ]);
  });

  it("stays held while the competition has no participation document attached: the safe side", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, {
      guardianDocuments: ["public_display"],
    });
    const child = await guardianWithChild(h, competition);
    const unattached = await publishNextVersion(h, "participation");

    expect(
      await giveParticipation(h, child, competition, unattached.id)
    ).toEqual({ ok: false, error: "purpose_not_offered" });
    expect(await statusOf(h, child.registrationId)).toBe("pending_guardian");
  });

  it("is held again for the new version once a manager re-attaches participation, until given on it", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    await giveParticipation(h, child, competition);
    const v2 = await publishNextVersion(h, "participation");
    await reattach(h, competition.id, "participation", v2.id);

    expect(
      await h
        .as(child.actor)
        .payForMyRegistration({ registrationId: child.registrationId })
    ).toEqual({ ok: false, error: "participation_consent_required" });
    await giveParticipation(h, child, competition, v2.id);
    expect(
      await h
        .as(child.actor)
        .payForMyRegistration({ registrationId: child.registrationId })
    ).toMatchObject({ ok: true, kind: "checkout" });
  });
});

describe("withdrawing participation before payment", () => {
  it("refuses payment with participation_consent_required, opening no order", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    await giveParticipation(h, child, competition);
    await h.as(child.actor).withdrawChildConsent({
      childId: child.childId,
      competitionId: competition.id,
      purpose: "participation",
    });

    expect(
      await h
        .as(child.actor)
        .payForMyRegistration({ registrationId: child.registrationId })
    ).toEqual({ ok: false, error: "participation_consent_required" });
    expect(h.gateway.orders).toEqual([]);
    expect(await h.db.select().from(paymentBatch)).toEqual([]);
  });

  it("refuses a free confirmation for an entry made as a minor after the entrant turns 18", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, { fee: 0n });
    const child = await guardianWithChild(h, competition, { age: 17 });
    await giveParticipation(h, child, competition);
    h.clock.set("2027-12-15T18:30:00.000Z");
    await h.as(child.actor).withdrawChildConsent({
      childId: child.childId,
      competitionId: competition.id,
      purpose: "participation",
    });

    expect(
      await h
        .as(child.actor)
        .payForMyRegistration({ registrationId: child.registrationId })
    ).toEqual({ ok: false, error: "participation_consent_required" });
    expect(await statusOf(h, child.registrationId)).toBe("pending_payment");
  });

  it("withholds checkout after consent is withdrawn while an order is opening", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    const guardian = h.as(child.actor);
    await giveParticipation(h, child, competition);
    const orderCreated = Promise.withResolvers<{ orderId: string }>();
    const releaseGateway = Promise.withResolvers<void>();
    const createOrder = h.gateway.createOrder.bind(h.gateway);
    vi.spyOn(h.gateway, "createOrder").mockImplementationOnce(async (input) => {
      const order = await createOrder(input);
      orderCreated.resolve(order);
      await releaseGateway.promise;
      return order;
    });

    const registration = { registrationId: child.registrationId };
    const paying = guardian.payForMyRegistration(registration);
    try {
      await Promise.race([orderCreated.promise, paying]);
      expect(
        await guardian.withdrawChildConsent({
          childId: child.childId,
          competitionId: competition.id,
          purpose: "participation",
        })
      ).toEqual({ ok: true, changed: true });
    } finally {
      releaseGateway.resolve();
    }
    await expect(paying).resolves.toEqual({
      ok: false,
      error: "participation_consent_required",
    });

    const { orderId } = await orderCreated.promise;
    await giveParticipation(h, child, competition);
    expect(await guardian.payForMyRegistration(registration)).toMatchObject({
      ok: true,
      kind: "checkout",
      checkout: { orderId },
    });
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("holds a capture in review until consent is restored or the payment is refunded", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    const guardian = h.as(child.actor);
    await giveParticipation(h, child, competition);
    const registrationInput = { registrationId: child.registrationId };
    const paid = await guardian.payForMyRegistration(registrationInput);
    if (!paid.ok || paid.kind !== "checkout") throw new Error("No order");
    await guardian.withdrawChildConsent({
      childId: child.childId,
      competitionId: competition.id,
      purpose: "participation",
    });

    const { orderId } = paid.checkout;
    const { paymentId } = h.gateway.capture(orderId);
    const webhook = h.gateway.webhook({ type: "payment.captured", orderId });
    const payerSignal = h.as(h.visitor());
    expect(await payerSignal.receiveGatewayWebhook(webhook)).toMatchObject({
      ok: true,
      outcome: "needs_review",
    });
    await payerSignal.receiveGatewayWebhook(webhook);
    expect(await statusOf(h, child.registrationId)).toBe("pending_payment");
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "payment.batch_captured"))
    ).toEqual([]);

    const finance = h.as((await signInStaff(h, "finance")).actor);
    const review = await finance.listPaymentReviewCases({ state: "open" });
    if (!review.ok) throw new Error("Payment review unavailable");
    expect(review.cases).toMatchObject([
      {
        batchId: paid.batchId,
        gatewayPaymentId: paymentId,
        amountMinor: 25_000n,
        reason: "participation_consent_required",
      },
    ]);
    const resolution = {
      caseId: review.cases[0]!.id,
      outcome: "confirm",
      reason: "Accept the original payment for this registration.",
    };
    expect(await finance.resolvePaymentReviewCase(resolution)).toEqual({
      ok: false,
      error: "registration_not_payable",
    });
    await giveParticipation(h, child, competition);
    await expect(
      guardian.payForMyRegistration(registrationInput)
    ).resolves.toEqual({
      ok: false,
      error: "nothing_to_pay",
    });
    expect(h.gateway.orders).toHaveLength(1);
    expect(await finance.resolvePaymentReviewCase(resolution)).toEqual({
      ok: true,
      batchStatus: "captured",
    });
    expect(
      await guardian.payForMyRegistration(registrationInput)
    ).toMatchObject({
      ok: true,
      kind: "confirmed",
    });
    expect(await h.db.select().from(paymentBatch)).toMatchObject([
      { id: paid.batchId, status: "captured", gatewayPaymentId: paymentId },
    ]);
    expect(h.gateway.orders).toHaveLength(1);
  });

  it("confirms once participation is given again", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, { fee: 0n });
    const child = await guardianWithChild(h, competition);
    await giveParticipation(h, child, competition);

    expect(
      await h
        .as(child.actor)
        .payForMyRegistration({ registrationId: child.registrationId })
    ).toMatchObject({ ok: true, kind: "confirmed_free" });
  });
});

describe("a linked teen registering themselves", () => {
  it("is held until their guardian gives participation", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const teen = await h.seed.member({ name: "Rohan Desai" });
    const { account, childIds } = await h.seed.guardian({
      children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
    });
    const teenActor = await h.signIn(teen);
    const { fullName: _n, dateOfBirth: _d, ...form } = adultForm(competition);

    const held = await h.as(teenActor).registerAsIndividual(form);
    expect(held).toMatchObject({ ok: true, status: "pending_guardian" });
    if (!held.ok) throw new Error("unreachable");
    // Ticking participation on their own form gives nothing: it's not theirs.
    expect((await consentRows(h)).events).toEqual([]);

    const guardianActor = await h.signIn(account);
    await h.as(guardianActor).giveChildConsent({
      childId: childIds[0]!,
      competitionId: competition.id,
      purpose: "participation",
      documentId: competition.guardianDocuments.participation!,
    });
    expect(await statusOf(h, held.registrationId)).toBe("pending_payment");
  });
});

describe("an adult registering themselves", () => {
  it.each([0n, 25_000n])(
    "lets an entrant on a linked profile pay after registering as an adult (fee %s)",
    async (fee) => {
      const h = await createHarness();
      const entrant = await h.seed.member({ name: "Rohan Desai" });
      const family = await h.seed.guardian({
        children: [
          { fullName: "Rohan Desai", age: 17, loginUserId: entrant.id },
        ],
      });
      h.clock.set("2027-12-15T18:30:00.000Z");
      const competition = await consentCompetition(h, { fee });
      const registrant = h.as(await h.signIn(entrant));
      const guardian = h.as(await h.signIn(family.account));
      const {
        fullName: _name,
        dateOfBirth: _dob,
        ...form
      } = adultForm(competition, {
        consents: competition.documents.slice(0, 2),
      });

      const registered = await registrant.registerAsIndividual(form);
      expect(registered).toMatchObject({ ok: true, status: "pending_payment" });
      if (!registered.ok) throw new Error(registered.error);
      const { registrationId } = registered;

      expect
        .soft(await guardian.listMyRegistrations())
        .toMatchObject([
          { registrationId, heldFor: null, amountDue: { amountMinor: fee } },
        ]);
      expect((await consentRows(h)).events).toEqual([]);
      const payment = await guardian.payForMyRegistration({ registrationId });
      if (fee === 0n) {
        expect(payment).toMatchObject({ ok: true, kind: "confirmed_free" });
      } else {
        expect(payment).toMatchObject({ ok: true, kind: "checkout" });
        if (!payment.ok || payment.kind !== "checkout")
          throw new Error("No order");
        const { orderId } = payment.checkout;
        h.gateway.capture(orderId);
        const webhook = h.gateway.webhook({
          type: "payment.captured",
          orderId,
        });
        expect(
          await h.as(h.visitor()).receiveGatewayWebhook(webhook)
        ).toMatchObject({
          ok: true,
          outcome: "captured",
        });
      }
      expect(await statusOf(h, registrationId)).toBe("confirmed");
    }
  );

  it("is unaffected: waits for payment and pays with no guardian consent", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h, { fee: 0n });
    const adult = await signInMember(h, { name: "Ravi Kumar" });

    const registered = await h
      .as(adult.actor)
      .registerAsIndividual(adultForm(competition));
    expect(registered).toMatchObject({ ok: true, status: "pending_payment" });
    if (!registered.ok) throw new Error("unreachable");

    expect(
      await h
        .as(adult.actor)
        .payForMyRegistration({ registrationId: registered.registrationId })
    ).toMatchObject({ ok: true, kind: "confirmed_free" });
    expect((await consentRows(h)).events).toEqual([]);
  });
});
