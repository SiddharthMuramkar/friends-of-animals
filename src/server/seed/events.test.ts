import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedFunctions } from "./builders";
import { SEED_EVENTS, seedEvents } from "./events";
import { SEED_ACCOUNTS } from "./accounts";
import { event, eventRegistration } from "../db/schema";
import { asc } from "drizzle-orm";

it("seeds a full workshop, a campaign, an unpublished draft and past attendance, without duplicate registrations", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const publicApi = h.as(h.visitor());
  expect(
    (await publicApi.listPublishedEvents()).items.map((r) => r.slug)
  ).toEqual([
    SEED_EVENTS.full.slug,
    SEED_EVENTS.mobile.slug,
    SEED_EVENTS.campaign.slug,
  ]);
  const full = await publicApi.getPublicEvent({ slug: SEED_EVENTS.full.slug });
  expect(full).toMatchObject({
    ok: true,
    event: { placesLeft: 0, waitlistEnabled: true },
  });
  expect(
    await publicApi.getPublicEvent({ slug: SEED_EVENTS.draft.slug })
  ).toEqual({ ok: false, error: "not_found" });
  const adult = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
  expect((await adult.getTimeline()).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "event.attended",
        eventTitle: SEED_EVENTS.past.title,
      }),
    ])
  );
  const first = await h.db.select().from(event).orderBy(asc(event.id));
  const registrations = await h.db
    .select()
    .from(eventRegistration)
    .orderBy(asc(eventRegistration.id));
  // The full preview already supplied the accounts and verified the event
  // journeys; only the real event seeder writes the rows compared here.
  await seedFunctions([seedEvents]).seedPreview(h.deps);
  expect(await h.db.select().from(event).orderBy(asc(event.id))).toEqual(first);
  expect(
    await h.db
      .select()
      .from(eventRegistration)
      .orderBy(asc(eventRegistration.id))
  ).toEqual(registrations);
});
