import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { policyCheck } from "./can";
import { role } from "./domain/policy";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";
const SCHOOL_B = "01938a00-0000-7000-8000-00000000a002";

// A scoped action of the kind later tickets add (a school's roster, a
// round's entries), checked against grants read from the database.
const { can, authorize } = policyCheck({
  "roster.edit": role("institution_coordinator", "staff_admin"),
});

const inSchool = (id: string) => ({
  scopes: [{ type: "institution" as const, id }],
});

describe("can", () => {
  it("lets a scoped role act in its own scope only", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.seed.grant(member, {
      role: "institution_coordinator",
      scope: { type: "institution", id: SCHOOL_A },
    });
    const coordinator = { ...h.deps, actor: await h.signIn(member) };

    expect(await can(coordinator, "roster.edit", inSchool(SCHOOL_A))).toEqual({
      allowed: true,
      role: "institution_coordinator",
    });
    // Scope mismatch: another school.
    expect(await can(coordinator, "roster.edit", inSchool(SCHOOL_B))).toEqual({
      allowed: false,
    });
    // Same id, another kind of scope.
    expect(
      await can(coordinator, "roster.edit", {
        scopes: [{ type: "competition", id: SCHOOL_A }],
      })
    ).toEqual({ allowed: false });
  });

  it("lets a global role act in every scope", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.seed.grant(member, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const staff = { ...h.deps, actor: await h.signIn(member) };

    for (const school of [SCHOOL_A, SCHOOL_B]) {
      expect(await can(staff, "roster.edit", inSchool(school))).toEqual({
        allowed: true,
        role: "staff_admin",
      });
    }
  });

  it("refuses a visitor and a member without the role", async () => {
    const h = await createHarness();
    const member = { ...h.deps, actor: await h.signIn(await h.seed.member()) };
    const visitor = { ...h.deps, actor: h.visitor() };

    for (const ctx of [member, visitor]) {
      expect(await can(ctx, "roster.edit", inSchool(SCHOOL_A))).toEqual({
        allowed: false,
      });
    }
  });

  it("reads the grants afresh, so a new grant counts for an actor already signed in", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const coordinator = { ...h.deps, actor: await h.signIn(member) };
    expect(
      (await can(coordinator, "roster.edit", inSchool(SCHOOL_A))).allowed
    ).toBe(false);

    await h.seed.grant(member, {
      role: "institution_coordinator",
      scope: { type: "institution", id: SCHOOL_A },
    });

    expect(
      (await can(coordinator, "roster.edit", inSchool(SCHOOL_A))).allowed
    ).toBe(true);
  });
});

describe("authorize", () => {
  it("returns the role that allowed the action, and throws forbidden otherwise", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.seed.grant(member, {
      role: "institution_coordinator",
      scope: { type: "institution", id: SCHOOL_A },
    });
    const coordinator = { ...h.deps, actor: await h.signIn(member) };

    expect(
      await authorize(coordinator, "roster.edit", inSchool(SCHOOL_A))
    ).toEqual({ role: "institution_coordinator" });
    const refused = authorize(coordinator, "roster.edit", inSchool(SCHOOL_B));
    await expect(refused).rejects.toBeInstanceOf(DomainError);
    await expect(refused).rejects.toMatchObject({ code: "forbidden" });
  });
});
