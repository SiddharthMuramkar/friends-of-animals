import { describe, expect, it } from "vitest";

import { grantKey, grantSchema, isStaffRole, ROLES, sortGrants } from "./roles";

const INSTITUTION = "01938a00-0000-7000-8000-00000000a001";
const COMPETITION = "01938a00-0000-7000-8000-00000000c001";

describe("the role catalogue", () => {
  it("lists the sixteen roles of the platform spec", () => {
    expect([...ROLES].sort()).toEqual([
      "adoption_coordinator",
      "auction_manager",
      "community_manager",
      "competition_manager",
      "content_manager",
      "finance",
      "guardian",
      "institution_admin",
      "institution_coordinator",
      "judge",
      "member",
      "organisation_representative",
      "participant",
      "staff_admin",
      "super_admin",
      "volunteer",
    ]);
  });

  it("counts FOA's own roles as staff, and nobody else's", () => {
    const staff = ROLES.filter(isStaffRole);
    expect(staff.sort()).toEqual([
      "adoption_coordinator",
      "auction_manager",
      "community_manager",
      "competition_manager",
      "content_manager",
      "finance",
      "staff_admin",
      "super_admin",
    ]);
  });
});

describe("grantSchema", () => {
  it("accepts a global role", () => {
    expect(
      grantSchema.parse({ role: "super_admin", scope: { type: "global" } })
    ).toEqual({ role: "super_admin", scope: { type: "global" } });
  });

  it("accepts an institution role scoped to one institution", () => {
    const grant = {
      role: "institution_coordinator",
      scope: { type: "institution", id: INSTITUTION },
    };
    expect(grantSchema.parse(grant)).toEqual(grant);
  });

  it.each([
    ["super_admin", { type: "institution", id: INSTITUTION }],
    ["finance", { type: "competition", id: COMPETITION }],
    ["institution_admin", { type: "global" }],
    ["institution_coordinator", { type: "competition", id: COMPETITION }],
    ["organisation_representative", { type: "global" }],
  ])("refuses %s at scope %j", (role, scope) => {
    const result = grantSchema.safeParse({ role, scope });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("scope_not_allowed");
  });

  it("refuses a scoped grant without a valid id", () => {
    for (const scope of [
      { type: "institution" },
      { type: "institution", id: "not-a-uuid" },
    ]) {
      expect(
        grantSchema.safeParse({ role: "institution_admin", scope }).success
      ).toBe(false);
    }
  });

  it("refuses an id on a global scope and roles it doesn't know", () => {
    expect(
      grantSchema.safeParse({
        role: "staff_admin",
        scope: { type: "global", id: INSTITUTION },
      }).success
    ).toBe(false);
    expect(
      grantSchema.safeParse({ role: "owner", scope: { type: "global" } })
        .success
    ).toBe(false);
  });
});

describe("grantKey and sortGrants", () => {
  it("names a grant by role and scope", () => {
    expect(grantKey({ role: "member", scope: { type: "global" } })).toBe(
      "member@global"
    );
    expect(
      grantKey({
        role: "judge",
        scope: { type: "competition", id: COMPETITION },
      })
    ).toBe(`judge@competition:${COMPETITION}`);
  });

  it("orders grants by key and drops duplicates, so before and after compare", () => {
    const judge = {
      role: "judge",
      scope: { type: "competition", id: COMPETITION },
    } as const;
    const member = { role: "member", scope: { type: "global" } } as const;
    expect(sortGrants([member, judge, member])).toEqual([judge, member]);
  });
});
