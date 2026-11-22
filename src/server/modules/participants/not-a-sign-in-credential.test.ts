import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import { adultForm, openToIndividuals, signInMember } from "./testing";

// A registration number, given when a registration is confirmed, names it
// on receipts and the participant dashboard. It never signs anyone in:
// sign-in codes go only to an address or mobile the person proves they
// hold. A real number, from a real confirmed registration, is tried.

/** A confirmed registration's number and the Participant ID beside it. */
async function confirmedNumbers(h: Harness) {
  const competition = await openToIndividuals(h, { fee: 0n });
  const adult = await signInMember(h);
  const registered = await h
    .as(adult.actor)
    .registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const paid = await h
    .as(adult.actor)
    .payForMyRegistration({ registrationId: registered.registrationId });
  if (!paid.ok || paid.kind !== "confirmed_free") {
    throw new Error(JSON.stringify(paid));
  }
  return [paid.registrationNumber, registered.participantCode];
}

describe("a registration number", () => {
  it("is refused as the address for an email sign-in code, and nothing is sent", async () => {
    const h = await createHarness();
    const codes = await confirmedNumbers(h);
    const sentBefore = h.email.sent.length;

    for (const code of [...codes, ...codes.map((c) => c.toLowerCase())]) {
      expect(await h.as(h.visitor()).requestEmailCode({ email: code })).toEqual(
        { ok: false, error: "invalid_input", fields: ["email"] }
      );
    }
    expect(h.email.sent).toHaveLength(sentBefore);
  });

  it("is refused as the number for an SMS sign-in code, and nothing is texted", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    const codes = await confirmedNumbers(h);

    for (const code of codes) {
      expect(await h.as(h.visitor()).requestPhoneCode({ phone: code })).toEqual(
        { ok: false, error: "invalid_input", fields: ["phone"] }
      );
    }
    expect(h.sms.sent).toEqual([]);
  });
});
