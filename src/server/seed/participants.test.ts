import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  consentEvent,
  participantProfile,
  paymentBatch,
  registration,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_ACCOUNTS } from "./accounts";

async function rows(h: Harness) {
  return {
    profiles: await h.db
      .select()
      .from(participantProfile)
      .orderBy(asc(participantProfile.id)),
    registrations: await h.db
      .select()
      .from(registration)
      .orderBy(asc(registration.id)),
    batches: await h.db
      .select()
      .from(paymentBatch)
      .orderBy(asc(paymentBatch.id)),
    consents: await h.db
      .select()
      .from(consentEvent)
      .orderBy(asc(consentEvent.id)),
  };
}

describe("the participants seed", () => {
  it("gives Asha a confirmed registration with a number and Ravi one waiting for payment", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const [asha, ravi] = SEED_ACCOUNTS.members;

    const ashas = await h
      .as(await h.signIn(asha, undefined, { secondFactor: false }))
      .listMyRegistrations();
    const ravis = await h
      .as(await h.signIn(ravi, undefined, { secondFactor: false }))
      .listMyRegistrations();

    expect(ashas).toEqual([
      expect.objectContaining({
        competition: {
          name: "Neighbours on My Street",
          slug: "neighbours-on-my-street",
        },
        route: "individual",
        status: "confirmed",
        participantCode: "FOA-P-265EED01",
        registrationNumber: "NEIGH27-R-5EEDA1",
        amountDue: null,
      }),
    ]);
    expect(ravis).toEqual([
      expect.objectContaining({
        status: "pending_payment",
        participantCode: "FOA-P-265EED02",
        registrationNumber: null,
        amountDue: { amountMinor: 10_000n, currency: "INR" },
      }),
    ]);
    const [batch] = await h.db.select().from(paymentBatch);
    expect(
      (await h.db.select().from(paymentBatch)).filter(
        (each) => each.route === "individual"
      )
    ).toEqual([
      expect.objectContaining({
        status: "captured",
        payerUserId: asha.id,
        amountMinor: 10_000n,
        gateway: "fake",
      }),
    ]);
    expect(batch).toBeDefined();
  });

  it("changes nothing when run again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = await rows(h);

    await h.seed.preview();

    expect(await rows(h)).toEqual(once);
  });
});
