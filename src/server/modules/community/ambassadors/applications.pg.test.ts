import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgWorld, type PgWorld } from "@/test/pg";
import { SEED_ACCOUNTS } from "../../../seed/accounts";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});

it("serializes racing application submissions and review decisions without duplicate milestones", async () => {
  await world.seed.preview();
  const account = SEED_ACCOUNTS.members[0];
  const applicant = world.as(await world.signedIn(account));
  const managerAccount = await world.seed.superAdmin({
    email: world.uniqueEmail(),
  });
  await world.seed.authenticator(managerAccount);
  const manager = world.as(
    await world.signedIn(managerAccount, { secondFactor: true })
  );
  const applying = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from "user" where id=${account.id} for update`;
    const a = applicant.applyForAmbassador();
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = applicant.applyForAmbassador();
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  const submissions = await Promise.all([applying.a, applying.b]);
  expect(submissions.filter((result) => result.ok)).toHaveLength(1);
  expect(submissions).toContainEqual({ ok: false, error: "ineligible" });
  const applied = submissions.find((result) => result.ok);
  if (!applied?.ok) throw Error("No submitted application");
  const applicationId = applied.applicationId;
  const decisions = await world.sql.begin(async (blocker) => {
    await blocker`select 1 from "user" where id=${account.id} for update`;
    const a = manager.decideAmbassador({ applicationId, decision: "approve" });
    a.catch(() => {});
    await world.waitForLockWaiters(1);
    const b = manager.decideAmbassador({
      applicationId,
      decision: "decline",
      reason: "Reapply later.",
    });
    b.catch(() => {});
    await world.waitForLockWaiters(2);
    return { a, b };
  });
  const [approved, declined] = await Promise.all([decisions.a, decisions.b]);
  expect([approved.ok, declined.ok].filter(Boolean)).toHaveLength(1);
  const after = await applicant.getMyAmbassador();
  expect(after.application?.status).toBe(approved.ok ? "approved" : "declined");
  expect(
    (await applicant.getTimeline()).milestones.filter(
      ({ kind }) => kind === "ambassador"
    )
  ).toHaveLength(approved.ok ? 1 : 0);
  expect(
    await manager.decideAmbassador({ applicationId, decision: "approve" })
  ).toEqual({ ok: false, error: "invalid_transition" });
  expect(
    await manager.decideAmbassador({
      applicationId,
      decision: "decline",
      reason: "Retry",
    })
  ).toEqual({ ok: false, error: "invalid_transition" });
});
