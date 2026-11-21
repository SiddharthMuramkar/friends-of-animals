import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { auditLog, userRole } from "@/server/db/schema";
import type { TestDb } from "@/test/db";
import { createHarness, type Harness } from "@/test/harness";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";

const coordinatorOfA = {
  role: "institution_coordinator",
  scope: { type: "institution", id: SCHOOL_A },
} as const;

/**
 * The test database, where `meanwhile` commits just before each
 * transaction opens: another request's change landing between a use
 * case's first check and its write. PGlite runs one connection, so a real
 * race can't happen here; this puts one in the gap.
 */
function racing(db: TestDb, meanwhile: () => Promise<unknown>): TestDb {
  return new Proxy(db, {
    get(target, property) {
      if (property === "transaction") {
        return async (...args: Parameters<TestDb["transaction"]>) => {
          await meanwhile();
          return target.transaction(...args);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function rowCounts(h: Harness) {
  const [grants] = await h.db.select({ n: count() }).from(userRole);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { grants: grants?.n, auditEntries: entries?.n };
}

/** A super admin whose own role another super admin revokes mid-change. */
async function superAdminLosingTheRole(h: Harness) {
  const admin = await h.seed.superAdmin();
  const actor = await h.signIn(admin);
  const app = createApp({
    ...h.deps,
    db: racing(h.db, () =>
      h.db.delete(userRole).where(eq(userRole.userId, admin.id))
    ),
  });
  return app.as(actor);
}

describe("a role change racing the revoke of the actor's own role", () => {
  it("refuses a grant once the granter is no longer a super admin, and writes nothing", async () => {
    const h = await createHarness();
    await h.seed.superAdmin(); // someone else keeps the role
    const member = await h.seed.member();
    const asAdmin = await superAdminLosingTheRole(h);
    const before = await rowCounts(h);

    await expect(
      asAdmin.grantRole({ userId: member.id, ...coordinatorOfA })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(await rowCounts(h)).toEqual({
      grants: (before.grants ?? 0) - 1,
      auditEntries: before.auditEntries,
    });
  });

  it("refuses a revoke once the revoker is no longer a super admin, and writes nothing", async () => {
    const h = await createHarness();
    await h.seed.superAdmin();
    const member = await h.seed.member();
    await h.seed.grant(member, coordinatorOfA);
    const asAdmin = await superAdminLosingTheRole(h);
    const before = await rowCounts(h);

    await expect(
      asAdmin.revokeRole({ userId: member.id, ...coordinatorOfA })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(await rowCounts(h)).toEqual({
      grants: (before.grants ?? 0) - 1,
      auditEntries: before.auditEntries,
    });
  });
});
