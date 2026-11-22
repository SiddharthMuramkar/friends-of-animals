import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import {
  adultForm,
  openToIndividuals,
  signInMember,
  type OpenCompetition,
} from "./testing";

/** A signed-in adult registered for `competition`, not yet paid. */
async function registered(h: Harness, competition: OpenCompetition) {
  const adult = await signInMember(h, { name: "Ravi Kumar" });
  const result = await h
    .as(adult.actor)
    .registerAsIndividual(adultForm(competition, { fullName: "Ravi Kumar" }));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { ...adult, ...result };
}

describe("an adult's own messages", () => {
  it("sends the payer a receipt with their registration number once the gateway captures the payment", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, { name: "Paws on Paper" });
    const ravi = await registered(h, competition);
    const paid = await h
      .as(ravi.actor)
      .payForMyRegistration({ registrationId: ravi.registrationId });
    if (!paid.ok || paid.kind !== "checkout") throw new Error("no order");
    const { paymentId } = h.gateway.capture(paid.checkout.orderId);
    await h.as(h.visitor()).receiveGatewayWebhook(
      h.gateway.webhook({
        type: "payment.captured",
        orderId: paid.checkout.orderId,
      })
    );
    const [mine] = await h.as(ravi.actor).listMyRegistrations();
    const number = mine?.registrationNumber ?? "missing";
    const mark = h.email.sent.length;

    await h.drain();

    const sent = h.email.sent
      .slice(mark)
      .filter((each) => each.to === ravi.email);
    const receipt = sent.find((each) =>
      each.subject.startsWith("Payment received")
    );
    expect(receipt?.subject).toBe("Payment received for Paws on Paper");
    expect(receipt?.text).toContain("Hello Ravi Kumar,");
    expect(receipt?.text).toContain("₹250.00");
    expect(receipt?.text).toContain(number);
    expect(receipt?.text).toContain(ravi.participantCode);
    expect(receipt?.text).toContain(paymentId);
    const confirmation = sent.find((each) =>
      each.subject.startsWith("You are registered")
    );
    expect(confirmation?.subject).toBe("You are registered for Paws on Paper");
    expect(confirmation?.text).toContain(number);
    // Nothing worded for a school's payment reaches them.
    for (const message of sent) {
      expect(message.text).not.toMatch(/student|institution|family/i);
    }
    expect(sent).toHaveLength(2);
  });

  it("confirms a free registration by email with its number, and sends no receipt", async () => {
    const h = await createHarness();
    const competition = await openToIndividuals(h, {
      name: "A Bowl of Water",
      fee: 0n,
    });
    const ravi = await registered(h, competition);
    const confirmed = await h
      .as(ravi.actor)
      .payForMyRegistration({ registrationId: ravi.registrationId });
    if (!confirmed.ok || confirmed.kind !== "confirmed_free") {
      throw new Error(JSON.stringify(confirmed));
    }
    const mark = h.email.sent.length;

    await h.drain();

    const sent = h.email.sent
      .slice(mark)
      .filter((each) => each.to === ravi.email);
    expect(sent.map((each) => each.subject)).toEqual([
      "You are registered for A Bowl of Water",
    ]);
    expect(sent[0]?.text).toContain(confirmed.registrationNumber);
  });
});
