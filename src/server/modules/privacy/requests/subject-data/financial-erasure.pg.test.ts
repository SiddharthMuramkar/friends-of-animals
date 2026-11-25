import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { recurringDonation, privacyRequest, user } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;
beforeAll(async () => {
  world = createPgWorld();
  await world.deps.settings.set("donations.enabled", true);
  await world.deps.settings.set("donations.recurringEnabled", true);
  await world.deps.settings.set("privacy.erasureEnabled", true);
});
afterAll(async () => {
  await world.close();
});

it("will not persist a mandate whose gateway draft raced an approved erasure", async () => {
  const donor = await world.seed.member({ email: world.uniqueEmail() });
  const actor = await world.signedIn(donor);
  const app = world.as(actor);
  const officerAccount = await world.seed.member({
    email: world.uniqueEmail(),
  });
  await world.seed.grant(officerAccount, {
    role: "grievance_officer",
    scope: { type: "global" },
  });
  await world.seed.authenticator(officerAccount);
  const officer = world.as(
    await world.signedIn(officerAccount, { secondFactor: true })
  );
  const filed = await app.submitPrivacyRequest({
    type: "erasure",
    subject: { kind: "self" },
  });
  if (!filed.ok) throw new Error("Cannot file erasure");
  await officer.startPrivacyRequest({ id: filed.requestId });
  const preview = await officer.previewErasure({ id: filed.requestId });
  if (!preview.ok) throw new Error("Cannot preview erasure");
  let starting: ReturnType<typeof app.startRecurringDonation> | undefined;
  // Only the local test database; hold the same advisory lock the worker
  // uses, so the fake gateway has created the unauthorised draft when the
  // officer approves, but the gift cannot yet be committed to the account.
  await world.sql.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(115, hashtext(${donor.id}))`;
    starting = app.startRecurringDonation({
      amountMinor: 120_000n,
      showOnWall: true,
      declaredAdult: true,
      declaredIndianSource: true,
    });
    await world.waitForLockWaiters(1);
    expect(world.gateway.subscriptions).toHaveLength(1);
    expect(
      await officer.executeErasure({
        id: filed.requestId,
        fingerprint: preview.preview.plan.fingerprint,
      })
    ).toEqual({ ok: true });
  });
  expect(await starting).toMatchObject({
    ok: false,
    error: "donations_closed",
  });
  expect(
    await world.db
      .select()
      .from(recurringDonation)
      .where(eq(recurringDonation.userId, donor.id))
  ).toEqual([]);
  expect(world.gateway.subscriptions).toMatchObject([{ status: "cancelled" }]);
  await world.drain();
  expect(
    await world.db
      .select()
      .from(privacyRequest)
      .where(eq(privacyRequest.id, filed.requestId))
  ).toMatchObject([{ status: "partially_completed" }]);
  expect(
    await world.db.select().from(user).where(eq(user.id, donor.id))
  ).toEqual([]);
});
