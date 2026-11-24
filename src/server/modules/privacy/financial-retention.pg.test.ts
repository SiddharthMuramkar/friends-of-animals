import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { paymentBatch, refund } from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

it("keeps a new refund that commits while retention waits for its payment lock", async () => {
  const now = world.clock.now();
  world.clock.set("2015-05-04T04:30:00Z");
  const code =
    Array.from({ length: 5 }, () =>
      String.fromCharCode(65 + randomInt(26))
    ).join("") + "27";
  const competition = await openToIndividuals(world, {
    code,
    name: `Refund race ${code}`,
  });
  const payer = await world.seed.member({ email: world.uniqueEmail() });
  const member = world.as(await world.signedIn(payer));
  const registered = await member.registerAsIndividual(adultForm(competition));
  if (!registered.ok) throw new Error(registered.error);
  const order = await member.payForMyRegistration({
    registrationId: registered.registrationId,
  });
  if (!order.ok || order.kind !== "checkout") throw new Error("No order");
  const {
    batchId,
    checkout: { orderId },
  } = order;
  world.gateway.capture(orderId);
  expect(
    await world
      .as({
        kind: "visitor",
        meta: { ip: "203.0.113.20", userAgent: "pg concurrency test" },
      })
      .receiveGatewayWebhook(
        world.gateway.webhook({ type: "payment.captured", orderId })
      )
  ).toMatchObject({ ok: true, outcome: "captured" });

  world.clock.set(now);
  const staff = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(staff);
  const actor = await world.signedIn(staff, { secondFactor: true });
  expect(
    await world
      .as(actor)
      .changeSetting({ key: "retention.enforce", value: true })
  ).toMatchObject({ ok: true });

  const inserted = Promise.withResolvers<void>();
  const allowCommit = Promise.withResolvers<void>();
  const reason = "The school requested a refund today.";
  const writing = world.db.transaction(async (tx) => {
    const app = createApp({ ...world.deps, db: tx }).as(actor);
    const requested = await app.requestRefund({ batchId, reason });
    if (!requested.ok) throw new Error(requested.error);
    // requestRefund has inserted the fresh activity and still holds its
    // batch lock. The sweep must wait before it can see the new refund.
    inserted.resolve();
    await allowCommit.promise;
    return requested.refundId;
  });
  const worker = world.as({ kind: "system", process: "worker" });
  let sweeping: ReturnType<typeof worker.runRetentionSweep> | undefined;
  try {
    await Promise.race([inserted.promise, writing]);
    sweeping = worker.runRetentionSweep();
    void sweeping.catch(() => {});
    await world.waitForLockWaiters(1);
  } finally {
    allowCommit.resolve();
    await Promise.allSettled([writing, sweeping]);
  }

  const [refundId, summary] = await Promise.all([writing, sweeping]);
  const [fresh] = await world.db
    .select()
    .from(refund)
    .where(eq(refund.id, refundId));
  expect(fresh).toMatchObject({
    requestedBy: staff.id,
    reason,
    status: "requested",
  });
  const [batch] = await world.db
    .select()
    .from(paymentBatch)
    .where(eq(paymentBatch.id, batchId));
  expect(batch?.payerUserId).toBe(payer.id);
  expect(summary?.policies.financialRecords).toMatchObject({ anonymised: 0 });
});
