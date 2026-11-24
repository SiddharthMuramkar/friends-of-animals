import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import {
  consentCompetition,
  guardianWithChild,
  publishNextVersion,
  reattach,
} from "@/server/modules/consent/testing";
import { schoolWithStudents } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import { bornYearsAgo } from "@/server/modules/guardians/testing";

import { adultForm, openToIndividuals, signInMember } from "./testing";

describe("listMyRegistrations", () => {
  it("lists only the member's own registrations, newest first, with what each needs", async () => {
    const h = await createHarness();
    const paid = await openToIndividuals(h, { name: "Paws on Paper" });
    const free = await openToIndividuals(h, {
      name: "A Bowl of Water",
      fee: 0n,
    });
    const asha = await signInMember(h);
    const ravi = await signInMember(h);
    const first = await h.as(asha.actor).registerAsIndividual(adultForm(paid));
    h.clock.advance({ minutes: 5 });
    const second = await h.as(asha.actor).registerAsIndividual(adultForm(free));
    await h.as(ravi.actor).registerAsIndividual(adultForm(paid));
    // A school's student is nobody's own registration.
    await schoolWithStudents(h, { students: 1 });
    if (!first.ok || !second.ok) throw new Error("Not registered");
    const confirmed = await h
      .as(asha.actor)
      .payForMyRegistration({ registrationId: second.registrationId });
    if (!confirmed.ok || confirmed.kind !== "confirmed_free") {
      throw new Error(JSON.stringify(confirmed));
    }

    expect(await h.as(asha.actor).listMyRegistrations()).toEqual([
      {
        registrationId: second.registrationId,
        whose: "mine",
        participantName: "Asha Rao",
        competition: { name: "A Bowl of Water", slug: free.slug },
        route: "individual",
        status: "confirmed",
        participantCode: first.participantCode,
        registrationNumber: confirmed.registrationNumber,
        maySubmitEntry: true,
        amountDue: null,
        childId: null,
        heldFor: null,
        createdAt: h.clock.now(),
      },
      {
        registrationId: first.registrationId,
        whose: "mine",
        participantName: "Asha Rao",
        competition: { name: "Paws on Paper", slug: paid.slug },
        route: "individual",
        status: "pending_payment",
        participantCode: first.participantCode,
        registrationNumber: null,
        maySubmitEntry: false,
        amountDue: { amountMinor: 25_000n, currency: "INR" },
        childId: null,
        heldFor: null,
        createdAt: new Date(h.clock.now().getTime() - 5 * 60_000),
      },
    ]);
  });

  it("says what a held registration waits for: a guardian to confirm, or the guardian's consent (#82)", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, { name: "Paws on Paper" });
    const teen = await h.seed.member({ name: "Rohan Desai" });
    const family = await h.seed.guardian({
      children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
    });
    const rohan = await h.signIn(teen);
    const { fullName: _n, dateOfBirth: _d, ...form } = adultForm(competition);
    const held = await h.as(rohan).registerAsIndividual(form);
    if (!held.ok) throw new Error(JSON.stringify(held));
    const alone = await signInMember(h, { name: "Meera Iyer" });
    await h.as(alone.actor).registerAsIndividual({
      ...adultForm(competition, {
        fullName: "Meera Iyer",
        dateOfBirth: bornYearsAgo(h, 15, 30),
      }),
      guardian: {
        fullName: "Lakshmi Iyer",
        relationship: "parent",
        email: "lakshmi@example.test",
      },
    });

    expect(
      await h.as(await h.signIn(family.account)).listMyRegistrations()
    ).toEqual([
      expect.objectContaining({
        registrationId: held.registrationId,
        whose: "child",
        status: "pending_guardian",
        childId: family.childIds[0],
        heldFor: "consent",
        amountDue: null,
      }),
    ]);
    expect(await h.as(rohan).listMyRegistrations()).toEqual([
      expect.objectContaining({
        whose: "mine",
        childId: null,
        heldFor: "consent",
      }),
    ]);
    expect(await h.as(alone.actor).listMyRegistrations()).toEqual([
      expect.objectContaining({ whose: "mine", heldFor: "guardian" }),
    ]);
  });

  it("is empty for a member who hasn't registered", async () => {
    const h = await createHarness();
    const member = await signInMember(h);

    expect(await h.as(member.actor).listMyRegistrations()).toEqual([]);
  });

  it.each(["withdrawn", "replaced"] as const)(
    "holds an unpaid child's registration when participation consent is %s",
    async (change) => {
      const h = await createHarness();
      const competition = await consentCompetition(h);
      const child = await guardianWithChild(h, competition);
      const guardian = h.as(child.actor);
      const consent = {
        childId: child.childId,
        competitionId: competition.id,
        purpose: "participation",
      } as const;
      const initialDocument = competition.guardianDocuments.participation!;
      await guardian.giveChildConsent({
        ...consent,
        documentId: initialDocument,
      });
      expect(await guardian.listMyRegistrations()).toMatchObject([
        { heldFor: null, amountDue: { amountMinor: 25_000n, currency: "INR" } },
      ]);

      let documentId = initialDocument;
      if (change === "withdrawn") {
        await guardian.withdrawChildConsent(consent);
      } else {
        const next = await publishNextVersion(h, "participation");
        documentId = next.id;
        await reattach(h, competition.id, "participation", documentId);
      }

      expect(await guardian.listMyRegistrations()).toMatchObject([
        {
          registrationId: child.registrationId,
          childId: child.childId,
          status: "pending_payment",
          heldFor: "consent",
          amountDue: null,
        },
      ]);
      await guardian.giveChildConsent({ ...consent, documentId });
      expect(await guardian.listMyRegistrations()).toMatchObject([
        { heldFor: null, amountDue: { amountMinor: 25_000n, currency: "INR" } },
      ]);
    }
  );

  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(h.as(h.visitor()).listMyRegistrations()).rejects.toThrow(
      DomainError
    );
  });
});

describe("hasMyRegistrations", () => {
  it("says whether the member has registered themselves for anything", async () => {
    const h = await createHarness();
    const paid = await openToIndividuals(h, { name: "Paws on Paper" });
    const asha = await signInMember(h);
    const ravi = await signInMember(h);
    // A school's student is nobody's own registration.
    await schoolWithStudents(h, { students: 1 });

    expect(await h.as(asha.actor).hasMyRegistrations()).toBe(false);
    const registered = await h
      .as(asha.actor)
      .registerAsIndividual(adultForm(paid));
    if (!registered.ok) throw new Error(JSON.stringify(registered));

    expect(await h.as(asha.actor).hasMyRegistrations()).toBe(true);
    expect(await h.as(ravi.actor).hasMyRegistrations()).toBe(false);
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(h.as(h.visitor()).hasMyRegistrations()).rejects.toThrow(
      DomainError
    );
  });
});
