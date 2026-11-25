import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { validRegistration } from "../institutions/testing";
let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});
it("serializes competing approval at the institution lock so only one club takes its place", async () => {
  await world.deps.settings.set("clubs.enabled", true);
  await world.deps.settings.set("clubs.maxPerInstitution", 1);
  const principal = await world.seed.member({ email: world.uniqueEmail() });
  const teacher = await world.seed.member({ email: world.uniqueEmail() });
  const office = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(office);
  const reviewer = world.as(
    await world.signedIn(office, { secondFactor: true })
  );
  const admin = world.as(await world.signedIn(principal));
  const created = await admin.registerInstitution(validRegistration());
  if (!created.ok) throw new Error(created.error);
  const institutionId = created.institutionId;
  expect(
    await reviewer.decideInstitution({
      institutionId,
      decision: "verify",
      reason: "Verified school",
    })
  ).toMatchObject({ ok: true });
  await world.seed.grant(teacher, {
    role: "institution_coordinator",
    scope: { type: "institution", id: institutionId },
  });
  const first = await admin.applyForClub({ institutionId, name: "First club" });
  const second = await world
    .as(await world.signedIn(teacher))
    .applyForClub({ institutionId, name: "Second club" });
  if (!first.ok || !second.ok) throw new Error("Could not apply");
  const requests = await world.sql.begin(async (blocker) => {
    await blocker`select id from institution where id=${institutionId} for update`;
    const a = reviewer.approveClub({ clubId: first.clubId });
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = reviewer.approveClub({ clubId: second.clubId });
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  expect(await Promise.all([requests.a, requests.b])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ok: true, status: "approved" }),
      { ok: false, error: "club_limit_reached" },
    ])
  );
  const listed = (await reviewer.listClubsForReview()).clubs.filter(
    (row) => row.institutionId === institutionId
  );
  expect(listed.filter((row) => row.status === "approved")).toHaveLength(1);
  expect(listed.filter((row) => row.status === "applied")).toHaveLength(1);
});
