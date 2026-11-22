import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, userRole } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";

const coordinatorOfA = {
  role: "institution_coordinator",
  scope: { type: "institution", id: SCHOOL_A },
} as const;
const globalJudge = { role: "judge", scope: { type: "global" } } as const;
const globalSuperAdmin = {
  role: "super_admin",
  scope: { type: "global" },
} as const;

async function rowCounts(h: Harness) {
  const [grants] = await h.db.select({ n: count() }).from(userRole);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { grants: grants?.n, auditEntries: entries?.n };
}

describe("revokeRole", () => {
  it("lets a super admin take a scoped role away, so their roles no longer list it", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    await h.seed.grant(member, coordinatorOfA, globalJudge);

    expect(
      await h.as(admin).revokeRole({ userId: member.id, ...coordinatorOfA })
    ).toEqual({ ok: true, changed: true, grant: coordinatorOfA });

    expect(
      await h.as(admin).listUserRoles({ userId: member.id })
    ).toMatchObject({ ok: true, grants: [globalJudge] });
  });

  it("counts at once: the same signed-in actor is refused straight after", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    await h.seed.grant(member, globalSuperAdmin);
    const other = await h.seed.member();
    const memberActor = await h.signIn(member);
    const grantJudge = () =>
      h.as(memberActor).grantRole({ userId: other.id, ...globalJudge });
    expect(await grantJudge()).toMatchObject({ ok: true });

    await h.as(admin).revokeRole({ userId: member.id, ...globalSuperAdmin });

    await expect(grantJudge()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("records one audit entry with the user's grants before and after", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    const adminActor = await h.signIn(admin, {
      ip: "198.51.100.30",
      userAgent: "Admin browser",
    });
    const member = await h.seed.member();
    await h.seed.grant(member, coordinatorOfA, globalJudge);

    await h.as(adminActor).revokeRole({ userId: member.id, ...coordinatorOfA });

    expect(await h.db.select().from(auditLog)).toEqual([
      {
        id: expect.any(String),
        occurredAt: h.clock.now(),
        actorKind: "user",
        actorUserId: admin.id,
        actorProcess: null,
        actorRole: "super_admin",
        action: "role.revoked",
        entityType: "user",
        entityId: member.id,
        before: [coordinatorOfA, globalJudge],
        after: [globalJudge],
        ip: "198.51.100.30",
        userAgent: "Admin browser",
      },
    ]);
  });

  it("changes nothing and records nothing for a grant the user doesn't hold", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    await h.seed.grant(member, globalJudge);
    const before = await rowCounts(h);

    expect(
      await h.as(admin).revokeRole({ userId: member.id, ...coordinatorOfA })
    ).toEqual({ ok: true, changed: false, grant: coordinatorOfA });
    expect(await rowCounts(h)).toEqual(before);
  });

  it("refuses a staff admin, a member and a visitor, and writes nothing", async () => {
    const h = await createHarness();
    const staffAdmin = await h.seed.member();
    await h.seed.grant(staffAdmin, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const member = await h.seed.member();
    const target = await h.seed.member();
    await h.seed.grant(target, coordinatorOfA);
    const before = await rowCounts(h);

    for (const actor of [
      await h.signIn(staffAdmin),
      await h.signIn(member),
      h.visitor(),
    ]) {
      await expect(
        h.as(actor).revokeRole({ userId: target.id, ...coordinatorOfA })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await rowCounts(h)).toEqual(before);
  });

  it("refuses to take away the last global super admin", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    const adminActor = await h.signIn(admin);
    const before = await rowCounts(h);

    expect(
      await h.as(adminActor).revokeRole({
        userId: admin.id,
        ...globalSuperAdmin,
      })
    ).toEqual({ ok: false, error: "last_super_admin" });
    expect(await rowCounts(h)).toEqual(before);
  });

  it("lets one super admin go while another remains", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    const second = await h.seed.superAdmin();

    expect(
      await h.as(await h.signIn(admin)).revokeRole({
        userId: second.id,
        ...globalSuperAdmin,
      })
    ).toMatchObject({ ok: true, changed: true });
  });

  it("refuses a user who doesn't exist, and input that isn't a grant", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).revokeRole({
        userId: "01938a00-0000-7000-8000-0000000000ff",
        ...coordinatorOfA,
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(admin).revokeRole({
        userId: "01938a00-0000-7000-8000-0000000000ff",
        role: "institution_coordinator",
        scope: { type: "institution", id: "school-a" },
      })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["scope"] });
  });
});
