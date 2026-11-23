import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { consentEvent, consentLink, outbox } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_REGISTRATIONS, SEED_STUDENTS } from "./registration";

it("seeds answered, pending and expired school links once and sends nothing", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const links = () =>
    h.db
      .select()
      .from(consentLink)
      .where(
        eq(
          consentLink.institutionRegistrationId,
          SEED_REGISTRATIONS.institution.id
        )
      )
      .orderBy(asc(consentLink.participantProfileId));
  const before = await links();
  expect(before).toMatchObject([
    {
      participantProfileId: SEED_STUDENTS[0]?.profileId,
      status: "used",
      answers: { public_display: "give", social_media: "decline" },
      tokenCiphertext: null,
    },
    { participantProfileId: SEED_STUDENTS[1]?.profileId, status: "pending" },
    { participantProfileId: SEED_STUDENTS[2]?.profileId, status: "pending" },
  ]);
  expect(before[1]!.expiresAt > h.clock.now()).toBe(true);
  expect(before[2]!.expiresAt <= h.clock.now()).toBe(true);
  const events = () =>
    h.db.select().from(consentEvent).where(eq(consentEvent.method, "otp_link"));
  expect(await events()).toMatchObject([
    {
      subjectId: SEED_STUDENTS[0]?.profileId,
      consentLinkId: before[0]?.id,
      giverUserId: null,
      purpose: "public_display",
      action: "given",
    },
  ]);
  expect(
    await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "consent.link_sent"))
  ).toHaveLength(0);
  const recorded = await events();
  await h.seed.preview();
  expect(JSON.stringify(await links()) === JSON.stringify(before)).toBe(true);
  expect(await events()).toEqual(recorded);
});
