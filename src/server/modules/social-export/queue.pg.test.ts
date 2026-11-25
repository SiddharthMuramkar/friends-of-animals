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

async function galleryFixture() {
  const code = `SOC${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}27`;
  const competition = await openToIndividuals(world, {
    code,
    name: `Social race ${code}`,
    fee: 0n,
    publicDisplay: true,
    guardianDocuments: ["participation", "public_display", "social_media"],
  });
  const account = await world.seed.member({ email: world.uniqueEmail() });
  const owner = world.as(await world.signedIn(account));
  const result = await owner.registerAsIndividual(adultForm(competition));
  if (!result.ok) throw Error(result.error);
  const registrationId = result.registrationId;
  expect(await owner.payForMyRegistration({ registrationId })).toMatchObject({
    ok: true,
  });
  const completed = await owner.completeEntryUpload(
    await putEntryImage(world, {
      actor: await world.signedIn(account),
      registrationId,
    })
  );
  if (!completed.ok) throw Error(completed.error);
  await world.drain();
  const [work] = await world.db
    .select()
    .from(entry)
    .where(eq(entry.registrationId, registrationId));
  if (!work) throw Error("Missing submitted work");
  // Entry verification has its own state-machine tests. Here the race
  // starts from the verified work and the actual rendered gallery copy.
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
  const picked = await curator.pickGalleryEntry({ entryId: work.id });
  if (!picked.ok) throw Error(picked.error);
  const ref = { itemId: picked.itemId };
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "Animal friends",
      story: "",
      featured: false,
    })
  ).toMatchObject({ ok: true });
  await world.drain();
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  return { ref, curator, owner, account, competition, person: person! };
}

it("serializes concurrent queue requests into one pending export and one social stamp", async () => {
  const { curator, ref, person } = await galleryFixture();
  const before = world.media.stamps.filter(
    (s) => s.variant === "social"
  ).length;
  const both = await world.sql.begin(async (blocker) => {
    await blocker`select id from participant_profile where id=${person.participantProfileId} for no key update`;
    const a = curator.queueSocialExport(ref);
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = curator.queueSocialExport(ref);
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  const outcomes = await Promise.all([both.a, both.b]);
  expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
  expect(outcomes).toContainEqual({ ok: false, error: "already_queued" });
  expect(
    (await curator.listSocialExports()).filter((i) => i.itemId === ref.itemId)
  ).toHaveLength(1);
  await world.drain();
  expect(world.media.stamps.filter((s) => s.variant === "social")).toHaveLength(
    before + 1
  );
});

it("refuses queueing when a concurrent creator withdrawal takes the subject lock first", async () => {
  const { curator, ref, owner, account, competition } = await galleryFixture();
  const both = await world.sql.begin(async (blocker) => {
    await blocker`select id from "user" where id=${account.id} for no key update`;
    const withdraw = owner.withdrawMyPublicUseConsent({
      competitionId: competition.id,
      purpose: "social_media",
    });
    withdraw.catch(() => {});
    await world.waitForLockWaiters(1);
    const queue = curator.queueSocialExport(ref);
    queue.catch(() => {});
    await world.waitForLockWaiters(2);
    return { withdraw, queue };
  });
  expect(await both.withdraw).toMatchObject({ ok: true, changed: true });
  expect(await both.queue).toEqual({ ok: false, error: "no_social_consent" });
  expect(
    (await curator.listSocialExports()).some((i) => i.itemId === ref.itemId)
  ).toBe(false);
  await world.drain();
});
