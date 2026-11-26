import { randomInt } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { entry, registration } from "../../db/schema";
import { adultForm, openToIndividuals } from "../participants/testing";
import { putEntryImage } from "../entries/testing";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => world.close());
it("serializes two curators picking the same eligible entry into one draft and stamp request", async () => {
  const code = `GAL${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}27`;
  const competition = await openToIndividuals(world, {
    code,
    name: `Gallery race ${code}`,
    fee: 0n,
    publicDisplay: true,
    guardianDocuments: ["participation", "public_display"],
  });
  const owner = await world.signedIn(
    await world.seed.member({ email: world.uniqueEmail() })
  );
  const registrationResult = await world
    .as(owner)
    .registerAsIndividual(adultForm(competition));
  if (!registrationResult.ok) throw Error(registrationResult.error);
  const registrationId = registrationResult.registrationId;
  expect(
    await world.as(owner).payForMyRegistration({ registrationId })
  ).toMatchObject({ ok: true });
  const completed = await world
    .as(owner)
    .completeEntryUpload(
      await putEntryImage(world, { actor: owner, registrationId })
    );
  if (!completed.ok) throw Error(completed.error);
  await world.drain();
  const [work] = await world.db
    .select()
    .from(entry)
    .where(eq(entry.registrationId, registrationId));
  if (!work) throw Error("Missing submitted work");
  // The race concerns curation, not the already-tested verification state
  // machine. Fixture the final verified entry state after the real upload.
  await world.db
    .update(entry)
    .set({ status: "foa_verified" })
    .where(eq(entry.id, work.id));
  const [person] = await world.db
    .select()
    .from(registration)
    .where(eq(registration.id, registrationId));
  const member = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(member, {
    role: "content_manager",
    scope: { type: "global" },
  });
  await world.seed.authenticator(member);
  const curator = world.as(
    await world.signedIn(member, { secondFactor: true })
  );
  const both = await world.sql.begin(async (blocker) => {
    await blocker`select id from participant_profile where id=${person!.participantProfileId} for no key update`;
    const a = curator.pickGalleryEntry({ entryId: work.id });
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = curator.pickGalleryEntry({ entryId: work.id });
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  const outcomes = await Promise.all([both.a, both.b]);
  expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
  expect(outcomes).toContainEqual({ ok: false, error: "already_picked" });
  const items = await curator.listGalleryItemsForAdmin();
  expect(items.filter((i) => i.entryCode === completed.entryCode)).toHaveLength(
    1
  );
  await world.drain();
  expect(
    world.media.stamps.filter((s) => s.variant === "gallery")
  ).toHaveLength(1);
  expect(
    world.media.stamps.filter((s) => s.variant === "gallery_thumb")
  ).toHaveLength(1);
});
