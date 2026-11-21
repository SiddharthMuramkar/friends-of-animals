import { describe, expect, it } from "vitest";

import { auditLog } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { bootstrapSuperAdmin } from "./bootstrap";

describe("bootstrapSuperAdmin", () => {
  it("creates a verified account and makes it a global super admin", async () => {
    const h = await createHarness();

    const result = await bootstrapSuperAdmin(h.deps, {
      email: " Owner@Example.test ",
      name: "Owner",
    });

    expect(result).toEqual({ userId: expect.any(String), changed: true });
    // The account signs in with an emailed code, like any other.
    const owner = await h.signIn({ email: "owner@example.test" });
    expect(await h.as(owner).myAccess()).toMatchObject({
      grants: [{ role: "super_admin", scope: { type: "global" } }],
    });
  });

  it("records the grant as made by the command line", async () => {
    const h = await createHarness();

    const { userId } = await bootstrapSuperAdmin(h.deps, {
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
        entityId: userId,
        before: [],
        after: [{ role: "super_admin", scope: { type: "global" } }],
      }),
    ]);
  });

  it("promotes an existing account as it is, and changes nothing the second time", async () => {
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
    ).toEqual({ userId: member.id, changed: true });
    expect(
      await bootstrapSuperAdmin(h.deps, {
        email: "asha@example.test",
        name: "Someone Else",
      })
    ).toEqual({ userId: member.id, changed: false });

    const asha = await h.signIn(member);
    expect(await h.as(asha).getAccount()).toEqual({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    expect(await h.db.select().from(auditLog)).toHaveLength(1);
  });
});
