import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { messageRoute } from "@/server/db/schema";
import { FakeEmail } from "@/test/fakes/email";
import { createPgWorld } from "@/test/pg";

import { sendAuthorityNotice } from "./authority-message";

it("holds an authority settings edit until the current email handoff finishes", async () => {
  const world = createPgWorld();
  const key = "breach.authorityEmail";
  const address = "filing-office@example.test";
  const route = eq(messageRoute.eventType, "breach.authority_notice");
  try {
    const admin = await world.seed.superAdmin({ email: world.uniqueEmail() });
    await world.seed.authenticator(admin);
    const staff = world.as(await world.signedIn(admin, { secondFactor: true }));
    await staff.changeSetting({ key, value: address });
    await world.db.update(messageRoute).set({ enabled: true }).where(route);
    const record = await staff.recordBreach({
      title: "Test notification",
      awareAt: world.clock.now(),
      severity: "low",
      personalDataInvolved: false,
      minorsAffected: false,
      affectedCount: 0,
      impact: "Synthetic lifecycle fixture.",
    });
    if (!record.ok) throw new Error("Recording failed");
    const request = { breachId: record.id };
    await expect(staff.notifyAuthority(request)).resolves.toEqual({
      ok: true,
      channel: "email",
    });

    const email = new FakeEmail(world.clock);
    const handoff = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const sending = sendAuthorityNotice(
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
      request
    );
    let change: ReturnType<typeof staff.changeSetting> | undefined;
    try {
      await Promise.race([handoff.promise, sending]);
      change = staff.changeSetting({ key, value: "" });
      const first = await Promise.race([
        change.then(() => "setting saved"),
        world.waitForLockWaiters(1).then(() => "setting edit waits"),
      ]);
      expect(first).toBe("setting edit waits");
    } finally {
      release.resolve();
      await Promise.all([sending, change]);
      await world.db.update(messageRoute).set({ enabled: false }).where(route);
    }

    await expect(change).resolves.toEqual({ ok: true, changed: true });
    expect(email.sent.map(({ to }) => to)).toEqual([address]);
    expect(await staff.getBreach(request)).toMatchObject({
      ok: true,
      breach: {
        authority: { emailConfigured: false, emailSentAt: world.clock.now() },
      },
    });
  } finally {
    await world.close();
  }
});
