import { afterAll, beforeAll, expect, it } from "vitest";

import { openToIndividuals } from "@/server/modules/participants/testing";
import { createPgWorld, type PgWorld } from "@/test/pg";

import { childForm } from "./testing";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

it("waits for a participation withdrawal already in progress before confirming", async () => {
  const family = await world.seed.guardian({
    email: world.uniqueEmail(),
    children: [{ fullName: "Asha Kulkarni", age: 15 }],
  });
  const guardian = world.as(await world.signedIn(family.account));
  const competition = await openToIndividuals(world, {
    fee: 0n,
    code: "WITHDR82",
    name: "Participation withdrawal",
  });
  const childId = family.childIds[0]!;
  const registered = await guardian.registerAsIndividual(
    childForm(competition, childId, { participation: true })
  );
  if (!registered.ok) throw new Error(registered.error);
  const { registrationId } = registered;

  const { withdrawing, confirming } = await world.sql.begin(async (blocker) => {
    // Hold only the append so withdrawal starts first and pauses before
    // committing its new event. Confirmation can still read existing events.
    await blocker`lock table consent_event in share mode`;
    const withdrawing = guardian.withdrawChildConsent({
      childId,
      competitionId: competition.id,
      purpose: "participation",
    });
    withdrawing.catch(() => {});
    await world.waitForLockWaiters(1);
    const confirming = guardian.payForMyRegistration({ registrationId });
    await Promise.race([world.waitForLockWaiters(2), confirming]);
    return { withdrawing, confirming };
  });

  await expect(withdrawing).resolves.toEqual({ ok: true, changed: true });
  await expect(confirming).resolves.toEqual({
    ok: false,
    error: "participation_consent_required",
  });
  expect(await guardian.listMyRegistrations()).toMatchObject([
    { registrationId, status: "pending_payment", registrationNumber: null },
  ]);
});
