import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, userRole } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";

const coordinatorOfA = {
  role: "institution_coordinator",
  scope: { type: "institution", id: SCHOOL_A },
} as const;

async function rowCounts(h: Harness) {
  const [grants] = await h.db.select({ n: count() }).from(userRole);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { grants: grants?.n, auditEntries: entries?.n };
}

describe("grantRole", () => {
  it("lets a super admin give a member a scoped role, which their roles then list", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin({ name: "Sunita Admin" });
    const adminActor = await h.signIn(admin);
    const member = await h.seed.member();

    expect(
      await h.as(adminActor).grantRole({ userId: member.id, ...coordinatorOfA })
    ).toEqual({ ok: true, changed: true, grant: coordinatorOfA });

    expect(await h.as(adminActor).listUserRoles({ userId: member.id })).toEqual(
      {
        ok: true,
        user: { id: member.id, name: member.name, email: member.email },
        grants: [
          {
            ...coordinatorOfA,
            grantedAt: h.clock.now(),
            grantedBy: { id: admin.id, name: "Sunita Admin" },
          },
        ],
      }
    );
  });

  it("counts at once, for the session the grantee already has", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    const other = await h.seed.member();
    const memberActor = await h.signIn(member);
    const grantJudge = () =>
      h.as(memberActor).grantRole({
        userId: other.id,
        role: "judge",
        scope: { type: "global" },
      });
    await expect(grantJudge()).rejects.toMatchObject({ code: "forbidden" });

    await h.as(admin).grantRole({
      userId: member.id,
      role: "super_admin",
      scope: { type: "global" },
    });

    // A staff role needs a second factor before it acts (#60).
    await expect(grantJudge()).rejects.toMatchObject({
      code: "enrolment_required",
    });
    await h.passSecondFactor(memberActor);
    expect(await grantJudge()).toMatchObject({ ok: true, changed: true });
  });

  it("records one audit entry with the grantee's grants before and after", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    const adminActor = await h.signIn(admin, {
      ip: "198.51.100.20",
      userAgent: "Admin browser",
    });
    const member = await h.seed.member();
    await h.seed.grant(member, { role: "judge", scope: { type: "global" } });

    await h.as(adminActor).grantRole({ userId: member.id, ...coordinatorOfA });

    expect(await h.db.select().from(auditLog)).toEqual([
      {
        id: expect.any(String),
        occurredAt: h.clock.now(),
        actorKind: "user",
        actorUserId: admin.id,
        actorProcess: null,
        actorRole: "super_admin",
        action: "role.granted",
        entityType: "user",
        entityId: member.id,
        before: [{ role: "judge", scope: { type: "global" } }],
        after: [coordinatorOfA, { role: "judge", scope: { type: "global" } }],
        ip: "198.51.100.20",
        userAgent: "Admin browser",
      },
    ]);

    const { entries } = await h.as(adminActor).getInventory();
    const fields = entries.filter(({ table }) => table === "audit_log");
    const actor = { kind: "user", via: "actor_user_id" };
    const target = { kind: "audit_target", via: "entity_type + entity_id" };
    expect(fields).toMatchObject(
      [
        ["actor_user_id", actor],
        ["after", target],
        ["before", target],
        ["entity_id", target],
        ["ip", actor],
        ["user_agent", actor],
      ].map(([column, subject]) => ({
        column,
        subject,
        retention: { policy: "auditLog" },
        onExpiry: "retain",
      }))
    );
  });

  it("changes nothing and records nothing for a grant the user already holds", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    await h.as(admin).grantRole({ userId: member.id, ...coordinatorOfA });
    const before = await rowCounts(h);

    expect(
      await h.as(admin).grantRole({ userId: member.id, ...coordinatorOfA })
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
    const before = await rowCounts(h);

    for (const actor of [
      await h.signIn(staffAdmin),
      await h.signIn(member),
      h.visitor(),
    ]) {
      await expect(
        h.as(actor).grantRole({ userId: target.id, ...coordinatorOfA })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await rowCounts(h)).toEqual(before);
  });

  it("refuses a role at a scope it can't hold", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    const before = await rowCounts(h);

    expect(
      await h.as(admin).grantRole({
        userId: member.id,
        role: "super_admin",
        scope: { type: "institution", id: SCHOOL_A },
      })
    ).toEqual({ ok: false, error: "scope_not_allowed" });
    expect(await rowCounts(h)).toEqual(before);
  });

  it("refuses input that isn't a user id, a role and a scope", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).grantRole({
        userId: "not-a-uuid",
        role: "overlord",
        scope: { type: "global" },
      } as never)
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["userId", "role"],
    });
  });

  it("refuses a user who doesn't exist", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const before = await rowCounts(h);

    expect(
      await h.as(admin).grantRole({
        userId: "01938a00-0000-7000-8000-0000000000ff",
        ...coordinatorOfA,
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await rowCounts(h)).toEqual(before);
  });
});

describe("listUserRoles", () => {
  it("shows a user their own roles, and a staff admin anyone's", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.seed.grant(member, coordinatorOfA);
    const staffAdmin = await h.seed.member();
    await h.seed.grant(staffAdmin, {
      role: "staff_admin",
      scope: { type: "global" },
    });

    for (const actor of [await h.signIn(member), await h.signIn(staffAdmin)]) {
      expect(
        await h.as(actor).listUserRoles({ userId: member.id })
      ).toMatchObject({
        ok: true,
        grants: [{ ...coordinatorOfA, grantedBy: null }],
      });
    }
  });

  it("refuses a member someone else's roles, and a visitor anyone's", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const other = await h.seed.member();

    for (const actor of [await h.signIn(member), h.visitor()]) {
      await expect(
        h.as(actor).listUserRoles({ userId: other.id })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("says so for a user who doesn't exist", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).listUserRoles({
        userId: "01938a00-0000-7000-8000-0000000000ff",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.as(admin).listUserRoles({ userId: "nope" })).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["userId"],
    });
  });
});
