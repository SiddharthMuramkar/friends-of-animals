import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { schoolWithStudents } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

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
        competition: { name: "A Bowl of Water", slug: free.slug },
        route: "individual",
        status: "confirmed",
        participantCode: first.participantCode,
        registrationNumber: confirmed.registrationNumber,
        amountDue: null,
        createdAt: h.clock.now(),
      },
      {
        registrationId: first.registrationId,
        competition: { name: "Paws on Paper", slug: paid.slug },
        route: "individual",
        status: "pending_payment",
        participantCode: first.participantCode,
        registrationNumber: null,
        amountDue: { amountMinor: 25_000n, currency: "INR" },
        createdAt: new Date(h.clock.now().getTime() - 5 * 60_000),
      },
    ]);
  });

  it("is empty for a member who hasn't registered", async () => {
    const h = await createHarness();
    const member = await signInMember(h);

    expect(await h.as(member.actor).listMyRegistrations()).toEqual([]);
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(h.as(h.visitor()).listMyRegistrations()).rejects.toThrow(
      DomainError
    );
  });
});
