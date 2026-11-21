import { describe, expect, it } from "vitest";

import { policyCheck } from "@/server/access/can";
import { role, signedIn } from "@/server/access/domain/policy";
import type { Role } from "@/server/access/domain/roles";
import { secondFactor } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { STAFF_ROLES } from "./domain/gate";

const global = { type: "global" } as const;

/** A member holding `roles` globally, signed in with only the email code. */
async function signedInHolding(h: Harness, ...roles: Role[]) {
  const member = await h.seed.member();
  for (const held of roles) {
    await h.seed.grant(member, { role: held, scope: global });
  }
  const actor = await h.signIn(member, undefined, { secondFactor: false });
  return { member, actor };
}

describe("the staff gate", () => {
  it("refuses every staff use case, and staffAccess, until a staff member enrols", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInHolding(h, "staff_admin");
    const other = await h.seed.member();

    expect(await h.as(actor).staffAccess()).toEqual({
      ok: false,
      code: "enrolment_required",
    });
    for (const staffUseCase of [
      () => h.as(actor).searchUsers({ query: "test" }),
      () => h.as(actor).searchAuditLog({}),
      () => h.as(actor).listUserRoles({ userId: other.id }),
    ]) {
      await expect(staffUseCase()).rejects.toMatchObject({
        code: "enrolment_required",
      });
    }
    // Their own things don't need a second factor.
    expect(
      await h.as(actor).listUserRoles({ userId: member.id })
    ).toMatchObject({ ok: true });
    expect(await h.as(actor).myAccess()).toHaveProperty("grants");
  });

  it("asks an enrolled staff member for the second factor in each new session", async () => {
    const h = await createHarness();
    const { member, actor: first } = await signedInHolding(h, "super_admin");
    await h.passSecondFactor(first);
    const second = await h.signIn(member, undefined, { secondFactor: false });

    expect(await h.as(first).staffAccess()).toEqual({ ok: true, staff: true });
    expect(await h.as(first).searchUsers({ query: "test" })).toMatchObject({
      ok: true,
    });

    expect(await h.as(second).staffAccess()).toEqual({
      ok: false,
      code: "second_factor_required",
    });
    await expect(
      h.as(second).searchUsers({ query: "test" })
    ).rejects.toMatchObject({ code: "second_factor_required" });

    h.clock.advance({ seconds: 30 });
    await h.passSecondFactor(second);
    expect(await h.as(second).staffAccess()).toEqual({ ok: true, staff: true });
  });

  it("keeps a passed second factor for the whole session, past the step-up window", async () => {
    const h = await createHarness();
    const { actor } = await signedInHolding(h, "staff_admin");
    await h.passSecondFactor(actor);

    h.clock.advance({ hours: 11 });

    expect(await h.as(actor).staffAccess()).toEqual({ ok: true, staff: true });
    expect(await h.as(actor).searchAuditLog({})).toMatchObject({ ok: true });
  });

  it.each(STAFF_ROLES)("gates %s", async (staffRole) => {
    const h = await createHarness();
    const { actor } = await signedInHolding(h, "member", staffRole);

    expect(await h.as(actor).staffAccess()).toEqual({
      ok: false,
      code: "enrolment_required",
    });
  });

  it.each<{ roles: Role[] }>([
    { roles: [] },
    { roles: ["member"] },
    { roles: ["judge", "participant", "guardian", "volunteer"] },
  ])("never asks someone holding $roles to enrol", async ({ roles }) => {
    const h = await createHarness();
    const { actor } = await signedInHolding(h, ...roles);

    expect(await h.as(actor).staffAccess()).toEqual({
      ok: true,
      staff: false,
    });
    expect(await h.as(actor).myAccess()).toHaveProperty("grants");
  });

  it("never asks a scoped institution or organisation role to enrol", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const school = { type: "institution", id: crypto.randomUUID() } as const;
    await h.seed.grant(
      member,
      { role: "institution_admin", scope: school },
      { role: "institution_coordinator", scope: school }
    );
    const actor = await h.signIn(member);

    expect(await h.as(actor).staffAccess()).toEqual({ ok: true, staff: false });
  });

  it("forgets a stamp once the factor behind it is gone", async () => {
    const h = await createHarness();
    const { actor } = await signedInHolding(h, "staff_admin");
    await h.passSecondFactor(actor);
    await h.db.delete(secondFactor);

    expect(await h.as(actor).staffAccess()).toEqual({
      ok: false,
      code: "enrolment_required",
    });
  });

  it("refuses visitors", async () => {
    const h = await createHarness();
    await expect(h.as(h.visitor()).staffAccess()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("can()", () => {
  // A staff action and a member action of the kind later tickets add.
  const { can, authorize } = policyCheck({
    "results.review": role("competition_manager"),
    "profile.edit": signedIn,
  });

  it("refuses an action a staff role allows until the session has passed a second factor", async () => {
    const h = await createHarness();
    const { actor } = await signedInHolding(h, "competition_manager");
    const ctx = { ...h.deps, actor };

    expect(await can(ctx, "results.review")).toEqual({
      allowed: false,
      secondFactor: "enrolment_required",
    });
    await expect(authorize(ctx, "results.review")).rejects.toMatchObject({
      code: "enrolment_required",
    });
    expect(await can(ctx, "profile.edit")).toEqual({
      allowed: true,
      role: null,
    });

    await h.passSecondFactor(actor);
    expect(await can(ctx, "results.review")).toEqual({
      allowed: true,
      role: "competition_manager",
    });
  });

  it("still refuses with forbidden what no role allows, before any second factor", async () => {
    const h = await createHarness();
    const { actor } = await signedInHolding(h, "finance");

    expect(await can({ ...h.deps, actor }, "results.review")).toEqual({
      allowed: false,
    });
  });
});
