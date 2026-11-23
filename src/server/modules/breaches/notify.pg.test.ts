import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { messageRoute, outbox, user } from "@/server/db/schema";
import { dispatchEvent } from "@/server/modules/notifications/dispatch";
import { FakeEmail } from "@/test/fakes/email";
import { createPgWorld } from "@/test/pg";

it("serializes direct notice handoff with account eligibility updates", async () => {
  const world = createPgWorld();
  const eventType = "breach.principal_notice";
  const route = eq(messageRoute.eventType, eventType);
  try {
    const admin = await world.seed.superAdmin({ email: world.uniqueEmail() });
    await world.seed.authenticator(admin);
    const staff = world.as(await world.signedIn(admin, { secondFactor: true }));
    const member = await world.seed.member({ email: world.uniqueEmail() });
    const record = await staff.recordBreach({
      title: "Synthetic incident",
      awareAt: world.clock.now(),
      severity: "low",
      personalDataInvolved: false,
      minorsAffected: false,
      affectedCount: 1,
      impact: "Ordinary delivery fixture.",
    });
    if (!record.ok) throw new Error("Recording failed");
    const breachId = record.id;
    await expect(
      staff.notifyAffectedUsers({
        breachId,
        subjects: [{ type: "user", id: member.id }],
      })
    ).resolves.toMatchObject({ ok: true, noticesQueued: 1 });
    const [job] = await world.db
      .select()
      .from(outbox)
      .where(eq(outbox.aggregateId, breachId));
    if (!job) throw new Error("Dispatch was not queued");

    await world.db.update(messageRoute).set({ enabled: true }).where(route);
    const email = new FakeEmail(world.clock);
    const handoff = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const dispatch = dispatchEvent(
      {
        ...world.deps,
        email: {
          async send(message) {
            handoff.resolve();
            await release.promise;
            await email.send(message);
          },
        },
      },
      {
        id: job.id,
        eventId: job.eventId,
        eventType,
        occurredAt: job.occurredAt,
        attempt: 1,
        payload: { breachId, recipientUserId: member.id },
      }
    );
    let eligibilityUpdate: Promise<unknown> | undefined;
    try {
      await Promise.race([handoff.promise, dispatch]);
      // Profile writers take this same account lock before saving eligibility.
      eligibilityUpdate = world.db.transaction((tx) =>
        tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, member.id))
          .for("no key update")
      );
      const first = await Promise.race([
        eligibilityUpdate.then(() => "account available"),
        world.waitForLockWaiters(1).then(() => "account locked"),
      ]);
      expect(first).toBe("account locked");
    } finally {
      release.resolve();
      await Promise.all([dispatch, eligibilityUpdate]);
      await world.db.update(messageRoute).set({ enabled: false }).where(route);
    }
    expect(email.sent.map(({ to }) => to)).toEqual([member.email]);
  } finally {
    await world.close();
  }
});
