import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, user, userRole } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { bootstrapSuperAdmin } from "./bootstrap";

async function accountsWith(h: Harness, email: string) {
  const [row] = await h.db
    .select({ n: count() })
    .from(user)
    .where(eq(user.email, email));
  return row?.n;
}

describe("bootstrapSuperAdmin", () => {
  it("creates a verified account and makes it a global super admin", async () => {
    const h = await createHarness();

    const result = await bootstrapSuperAdmin(h.deps, {
      email: " Owner@Example.test ",
      name: "Owner",
    });

    expect(result).toEqual({ ok: true, userId: expect.any(String) });
    // The account signs in with an emailed code, like any other.
    const owner = await h.signIn({ email: "owner@example.test" });
    expect(await h.as(owner).myAccess()).toMatchObject({
      grants: [{ role: "super_admin", scope: { type: "global" } }],
    });
  });

  it("records the grant as made by the command line", async () => {
    const h = await createHarness();

    const result = await bootstrapSuperAdmin(h.deps, {
      email: "owner@example.test",
      name: "Owner",
    });

    expect(await h.db.select().from(auditLog)).toEqual([
      expect.objectContaining({
        actorKind: "system",
        actorProcess: "cli",
        actorUserId: null,
        actorRole: null,
        action: "role.granted",
        entityType: "user",
        entityId: result.ok ? result.userId : "",
        before: [],
        after: [{ role: "super_admin", scope: { type: "global" } }],
      }),
    ]);
  });

  it("promotes an existing account as it is", async () => {
    const h = await createHarness();
    const member = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
    });

    expect(
      await bootstrapSuperAdmin(h.deps, {
        email: "asha@example.test",
        name: "Someone Else",
      })
    ).toEqual({ ok: true, userId: member.id });

    const asha = await h.signIn(member);
    expect(await h.as(asha).getAccount()).toEqual({
      name: "Asha Rao",
      email: "asha@example.test",
    });
  });

  it("refuses once any global super admin exists, and writes nothing", async () => {
    const h = await createHarness();
    await bootstrapSuperAdmin(h.deps, {
      email: "owner@example.test",
      name: "Owner",
    });

    for (const email of ["owner@example.test", "second@example.test"]) {
      expect(
        await bootstrapSuperAdmin(h.deps, { email, name: "Second" })
      ).toEqual({ ok: false, error: "super_admin_exists" });
    }
    expect(await accountsWith(h, "second@example.test")).toBe(0);
    expect(await h.db.select().from(userRole)).toHaveLength(1);
    expect(await h.db.select().from(auditLog)).toHaveLength(1);
  });

  it("leaves no account behind when the grant fails", async () => {
    const h = await createHarness();
    // Any failure after the account is made, here at the grant's insert.
    await h.db.execute(sql`
      create function refuse_grant() returns trigger language plpgsql as $$
      begin raise exception 'grant refused for the test'; end; $$
    `);
    await h.db.execute(sql`
      create trigger refuse_grant before insert on user_role
        for each row execute function refuse_grant()
    `);

    await expect(
      bootstrapSuperAdmin(h.deps, {
        email: "owner@example.test",
        name: "Owner",
      })
    ).rejects.toThrow();

    expect(await accountsWith(h, "owner@example.test")).toBe(0);
    expect(await h.db.select().from(auditLog)).toHaveLength(0);
  });
});
