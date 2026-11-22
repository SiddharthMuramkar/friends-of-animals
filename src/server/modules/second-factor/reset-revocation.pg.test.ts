// HR-19's administrative reset against a revocation of the initiating
// administrator's session, from separate connections on real PostgreSQL
// (`pnpm test:pg`). The reset must authorize and commit under a lock that
// a revocation of that session waits for, so a revoked initiator never
// commits a reset.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLog, secondFactor, session } from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";

let world: PgWorld;

beforeAll(() => {
  world = createPgWorld();
});

afterAll(async () => {
  await world.close();
});

/** A stepped-up super admin and a staff member holding one factor. */
async function adminAndTarget() {
  const admin = await world.seed.superAdmin({ email: world.uniqueEmail() });
  await world.seed.authenticator(admin);
  const target = await world.seed.member({ email: world.uniqueEmail() });
  await world.seed.grant(target, {
    role: "finance",
    scope: { type: "global" },
  });
  await world.seed.authenticator(target);
  return {
    actor: await world.signedIn(admin, { secondFactor: true }),
    target,
    targetSession: await world.signedIn(target, { secondFactor: true }),
  };
}

async function factorsOf(userId: string) {
  return world.db
    .select({ id: secondFactor.id })
    .from(secondFactor)
    .where(eq(secondFactor.userId, userId));
}

async function resetEntries(userId: string) {
  return world.db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, userId),
        eq(auditLog.action, "second_factor.reset")
      )
    );
}

async function sessionExists(sessionId: string) {
  const rows = await world.db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.id, sessionId));
  return rows.length > 0;
}

describe("administrative reset against revocation of the initiating session", () => {
  it("keeps the initiator's sign-out waiting until a reset already past its checks commits", async () => {
    const { actor, target, targetSession } = await adminAndTarget();
    // Another request holds the target's session row, so the reset stops
    // after authorizing, at ending the target's sessions.
    const blocker = await world.sql.reserve();
    try {
      await blocker`begin`;
      await blocker`select 1 from session where id = ${targetSession.sessionId} for update`;
      const reset = world.as(actor).resetSecondFactors({ userId: target.id });
      reset.catch(() => {});
      await world.waitForLockWaiters(1);

      // The administrator signs that session out meanwhile.
      const signOut = world
        .as(actor)
        .signOutSession({ sessionId: actor.sessionId });
      signOut.catch(() => {});
      const first = await Promise.race([
        signOut.then(() => "signed out" as const),
        world.waitForLockWaiters(2).then(() => "sign-out waits" as const),
      ]);
      expect(first).toBe("sign-out waits");

      await blocker`rollback`;
      expect(await reset).toEqual({ ok: true, removed: 1 });
      expect(await signOut).toMatchObject({ ok: true });
      expect(await sessionExists(actor.sessionId)).toBe(false);
    } finally {
      await blocker`rollback`.catch(() => {});
      blocker.release();
    }
  });

  it("refuses a reset whose initiating session is signed out while it waits, and changes nothing", async () => {
    const { actor, target } = await adminAndTarget();
    // The sign-out is in flight, not yet committed, when the reset starts.
    const signOut = await world.sql.reserve();
    try {
      await signOut`begin`;
      await signOut`delete from session where id = ${actor.sessionId}`;
      const reset = world.as(actor).resetSecondFactors({ userId: target.id });
      reset.catch(() => {});
      const first = await Promise.race([
        reset.then(
          () => "reset finished" as const,
          () => "reset finished" as const
        ),
        world.waitForLockWaiters(1).then(() => "reset waits" as const),
      ]);
      expect(first).toBe("reset waits");

      await signOut`commit`;
      await expect(reset).rejects.toMatchObject({ code: "forbidden" });
      expect(await factorsOf(target.id)).toHaveLength(1);
      expect(await resetEntries(target.id)).toEqual([]);
    } finally {
      await signOut`rollback`.catch(() => {});
      signOut.release();
    }
  });
});
