import { afterAll, beforeAll, expect, it } from "vitest";

import {
  openToIndividuals,
  publishedDocument,
} from "@/server/modules/participants/testing";
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

it("waits for the manager's participation version change before confirming a payment", async () => {
  const family = await world.seed.guardian({
    email: world.uniqueEmail(),
    children: [{ fullName: "Riya Rao", age: 15 }],
  });
  const guardian = world.as(await world.signedIn(family.account));
  const staff = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(staff, {
    role: "competition_manager",
    scope: { type: "global" },
  });
  await world.seed.authenticator(staff);
  const manager = world.as(await world.signedIn(staff, { secondFactor: true }));
  const competition = await openToIndividuals(world, {
    code: "REPIN82",
    name: "Participation document update",
  });
  const childId = family.childIds[0]!;
  const registered = await guardian.registerAsIndividual(
    childForm(competition, childId, { participation: true })
  );
  if (!registered.ok) throw new Error(registered.error);
  const { registrationId } = registered;
  const checkout = await guardian.payForMyRegistration({ registrationId });
  if (!checkout.ok || checkout.kind !== "checkout") throw new Error("No order");
  const documentId = await publishedDocument(world, "participation");
  const payment = world.gateway.capture(checkout.checkout.orderId);

  const { repinning, confirming, confirmation } = await world.sql.begin(
    async (blocker) => {
      // Keep the manager's attachment transaction open while the payment completes.
      await blocker`select 1 from competition_consent_document
      where competition_id = ${competition.id} and purpose = 'participation' for no key update`;
      const repinning = manager.attachConsentDocument({
        competitionId: competition.id,
        purpose: "participation",
      });
      await Promise.race([
        world.waitForLockWaiters(1),
        repinning.then(() => {
          throw new Error(
            "Attachment finished before its row lock was released"
          );
        }),
      ]);
      const confirming = guardian.confirmMyPayment({
        registrationId,
        ...payment,
      });
      const confirmation = await Promise.race([
        confirming.then(() => "finished"),
        world.waitForLockWaiters(2).then(() => "waiting"),
      ]);
      return { repinning, confirming, confirmation };
    }
  );

  await expect(repinning).resolves.toMatchObject({
    ok: true,
    changed: true,
    document: { id: documentId },
  });
  expect(confirmation).toBe("waiting");
  await expect(confirming).resolves.toEqual({
    ok: true,
    outcome: "needs_review",
  });
  expect(await guardian.listMyRegistrations()).toMatchObject([
    { registrationId, status: "pending_payment", registrationNumber: null },
  ]);
});
