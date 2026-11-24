import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { legalHold, session } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

async function activeHold() {
  const admin = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(admin);
  const actor = await world.signedIn(admin, { secondFactor: true });
  const held = await world.seed.member({ email: world.uniqueEmail() });
  const app = world.as(actor);
  const result = await app.placeLegalHold({
    subjectType: "user",
    subjectId: held.id,
    reason: "Pending inquiry",
  });
  if (!result.ok) throw new Error(result.error);
  return { app, actor, holdId: result.holdId };
}

it("refuses a hold release whose primary session expires waiting for the sweep", async () => {
  const { app, actor, holdId } = await activeHold();
  const expiresAt = new Date(world.clock.now().getTime() + 1000);
  await world.db
    .update(session)
    .set({ expiresAt })
    .where(eq(session.id, actor.sessionId));

  const sweep = await world.sql.reserve();
  try {
    await sweep`begin`;
    await sweep`select pg_advisory_xact_lock(114, 1)`;
    const release = app.releaseLegalHold({ holdId });
    void release.catch(() => {});
    await world.waitForLockWaiters(1);
    world.clock.set(expiresAt);
    await sweep`rollback`;

    await expect(release).rejects.toMatchObject({ code: "forbidden" });
    const [hold] = await world.db
      .select()
      .from(legalHold)
      .where(eq(legalHold.id, holdId));
    expect(hold?.releasedAt).toBeNull();
  } finally {
    await sweep`rollback`.catch(() => {});
    sweep.release();
  }
});

it("holds a competing sign-out until a hold release past authorization commits", async () => {
  const { app, actor, holdId } = await activeHold();
  const writing = await world.sql.reserve();
  try {
    await writing`begin`;
    await writing`select 1 from legal_hold where id = ${holdId} for update`;
    const release = app.releaseLegalHold({ holdId });
    void release.catch(() => {});
    await world.waitForLockWaiters(1);
    const signOut = app.signOutSession({ sessionId: actor.sessionId });
    void signOut.catch(() => {});

    const first = await Promise.race([
      signOut.then(() => "signed out"),
      world.waitForLockWaiters(2).then(() => "sign-out waits"),
    ]);
    await writing`rollback`;
    await expect(release).resolves.toEqual({ ok: true });
    await expect(signOut).resolves.toMatchObject({ ok: true });
    expect(first).toBe("sign-out waits");
  } finally {
    await writing`rollback`.catch(() => {});
    writing.release();
  }
});
