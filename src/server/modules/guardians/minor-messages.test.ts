import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { guardianLink, messageDelivery } from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { createHarness, type Harness } from "@/test/harness";

// #81: messages about a minor go to the minor's guardians. A confirmed
// registration of a guardian's child reaches the guardian by email and in
// the inbox; a teen with an own login gets an in-app copy only; a minor
// with no verified guardian is not messaged at all.

const ALL_AGES = [
  { label: "6–12", minAge: 6, maxAge: 12 },
  { label: "13–17", minAge: 13, maxAge: 17 },
  { label: "Adults", minAge: 18, maxAge: 99 },
];

/** What was emailed, leaving out sign-in codes. */
function messages(h: Harness) {
  return h.email.sent.filter(
    (message) => message.subject !== "Your Friends of Animals sign-in code"
  );
}

/** A free competition, so paying confirms at once. */
function freeCompetition(h: Harness) {
  return openToIndividuals(h, {
    fee: 0n,
    name: "A Bowl of Water",
    ageGroups: ALL_AGES,
  });
}

/** The guardian registers the child and confirms the free place. */
async function confirmChild(
  h: Harness,
  family: { account: Parameters<Harness["signIn"]>[0]; childIds: string[] },
  at = 0
) {
  const competition = await freeCompetition(h);
  const parent = await h.signIn(family.account);
  const { fullName: _n, dateOfBirth: _d, ...form } = adultForm(competition);
  const registered = await h
    .as(parent)
    .registerAsIndividual({ ...form, forChildId: family.childIds[at]! });
  if (!registered.ok) throw new Error(JSON.stringify(registered));
  const paid = await h
    .as(parent)
    .payForMyRegistration({ registrationId: registered.registrationId });
  if (!paid.ok || paid.kind !== "confirmed_free") {
    throw new Error(JSON.stringify(paid));
  }
  return { parent, registrationId: registered.registrationId };
}

describe("messages about a minor", () => {
  it("reach a teen's guardian by email and in the inbox, and the teen in the inbox only", async () => {
    const h = await createHarness();
    const teen = await h.seed.member({
      name: "Rohan Desai",
      email: "rohan@example.test",
    });
    const family = await h.seed.guardian({
      name: "Kavita Desai",
      email: "kavita@example.test",
      children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
    });
    const { parent } = await confirmChild(h, family);

    await h.drain();

    const email = messages(h).find((m) => m.to === "kavita@example.test");
    expect(email?.subject).toBe(
      "Rohan Desai is registered for A Bowl of Water"
    );
    expect(email?.text).toContain("Hello Kavita Desai");
    expect(email?.text).toMatch(/registration number is [A-Z]{3,6}\d{2}-R-/);
    expect(messages(h).map((m) => m.to)).toEqual(["kavita@example.test"]);
    expect(await h.as(parent).listInbox()).toEqual([
      expect.objectContaining({
        title: "Rohan Desai is registered for A Bowl of Water",
      }),
    ]);
    expect(await h.as(await h.signIn(teen)).listInbox()).toEqual([
      expect.objectContaining({
        title: "Rohan Desai is registered for A Bowl of Water",
      }),
    ]);
  });

  it("about a child under 13 reach the guardian only", async () => {
    const h = await createHarness();
    const family = await h.seed.guardian({
      name: "Kavita Desai",
      email: "kavita@example.test",
      children: [{ fullName: "Isha Desai", age: 9 }],
    });
    await confirmChild(h, family);

    await h.drain();

    expect(messages(h).map((m) => [m.to, m.subject])).toEqual([
      ["kavita@example.test", "Isha Desai is registered for A Bowl of Water"],
    ]);
  });

  it("about an adult reach the adult, worded for them, and no guardian", async () => {
    const h = await createHarness();
    const competition = await freeCompetition(h);
    const adult = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const asha = await h.signIn(adult);
    const registered = await h
      .as(asha)
      .registerAsIndividual(adultForm(competition));
    if (!registered.ok) throw new Error(JSON.stringify(registered));
    await h
      .as(asha)
      .payForMyRegistration({ registrationId: registered.registrationId });

    await h.drain();

    expect(messages(h).map((message) => message.subject)).toEqual([
      "You are registered for A Bowl of Water",
    ]);
  });

  it("go to nobody when the minor has no verified guardian, recorded as suppressed", async () => {
    const h = await createHarness();
    const teen = await h.seed.member({ email: "rohan@example.test" });
    const family = await h.seed.guardian({
      email: "kavita@example.test",
      children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
    });
    await confirmChild(h, family);
    // The guardian's link ends before the message goes.
    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, family.childIds[0]!));

    await h.drain();

    expect(messages(h)).toEqual([]);
    expect(await h.as(await h.signIn(teen)).listInbox()).toEqual([]);
    const rows = await h.db
      .select({
        channel: messageDelivery.channel,
        status: messageDelivery.status,
        reason: messageDelivery.reason,
      })
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.userId, teen.id),
          eq(messageDelivery.templateKey, "registration.confirmed_guardian")
        )
      );
    expect(rows).toEqual(
      expect.arrayContaining([
        { channel: "email", status: "suppressed", reason: "no_guardian" },
        { channel: "in_app", status: "suppressed", reason: "no_guardian" },
      ])
    );
    expect(rows).toHaveLength(2);
  });
});
