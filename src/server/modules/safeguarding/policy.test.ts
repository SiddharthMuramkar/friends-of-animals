import { describe, expect, it } from "vitest";

import { decide, type Subject } from "../../access/domain/policy";
import {
  grantSchema,
  isStaffRole,
  ROLES,
  type Grant,
  type Role,
} from "../../access/domain/roles";
import { POLICY } from "../../access/policies";
import {
  SAFEGUARDING_LEAD_ACTIONS,
  SAFEGUARDING_POLICY,
  type SafeguardingAction,
} from "./policy";

const USER = "01938a00-0000-7000-8000-000000000116";
const INSTITUTION = "01938a00-0000-7000-8000-00000000a116";

const holding = (...roles: Role[]): Subject => ({
  kind: "user",
  userId: USER,
  grants: roles.map(
    (role): Grant => ({ role, scope: { type: "global" } }) satisfies Grant
  ),
});

const leadActions = Object.keys(SAFEGUARDING_POLICY).filter((action) =>
  action.startsWith("safeguarding.")
) as SafeguardingAction[];

describe("who may read and handle safeguarding reports", () => {
  it("names a lead-only action for every lead use case", () => {
    expect([...leadActions].sort()).toEqual(
      [...SAFEGUARDING_LEAD_ACTIONS].sort()
    );
    expect(leadActions.length).toBeGreaterThan(0);
  });

  it.each(ROLES.filter((role) => role !== "safeguarding_lead"))(
    "refuses %s every safeguarding action",
    (role) => {
      for (const action of leadActions) {
        expect(
          decide(SAFEGUARDING_POLICY, holding(role), action, {}),
          action
        ).toEqual({ allowed: false });
      }
    }
  );

  it("refuses someone holding every other role at once, super admin included", () => {
    const everyOther = holding(
      ...ROLES.filter((role) => role !== "safeguarding_lead")
    );
    for (const action of leadActions) {
      expect(decide(SAFEGUARDING_POLICY, everyOther, action, {})).toEqual({
        allowed: false,
      });
    }
  });

  it("refuses a visitor, a signed-in user without roles and every process", () => {
    const subjects: Subject[] = [
      { kind: "visitor" },
      { kind: "user", userId: USER, grants: [] },
      { kind: "system", process: "seed" },
      { kind: "system", process: "worker" },
      { kind: "system", process: "cli" },
    ];
    for (const subject of subjects) {
      for (const action of leadActions) {
        expect(decide(SAFEGUARDING_POLICY, subject, action, {})).toEqual({
          allowed: false,
        });
      }
    }
  });

  it("allows a global safeguarding lead every safeguarding action, as that role", () => {
    for (const action of leadActions) {
      expect(
        decide(SAFEGUARDING_POLICY, holding("safeguarding_lead"), action, {})
      ).toMatchObject({ allowed: true, role: "safeguarding_lead" });
    }
  });

  it("joins the platform policy with the same rules", () => {
    for (const action of leadActions) {
      expect(decide(POLICY, holding("super_admin"), action, {}).allowed).toBe(
        false
      );
      expect(
        decide(POLICY, holding("safeguarding_lead"), action, {}).allowed
      ).toBe(true);
    }
  });
});

describe("who may file a concern", () => {
  it("lets a visitor and any signed-in user submit, and no process", () => {
    const submit = "safeguarding-concern.submit";
    expect(
      decide(SAFEGUARDING_POLICY, { kind: "visitor" }, submit, {}).allowed
    ).toBe(true);
    expect(
      decide(
        SAFEGUARDING_POLICY,
        { kind: "user", userId: USER, grants: [] },
        submit,
        {}
      ).allowed
    ).toBe(true);
    expect(
      decide(SAFEGUARDING_POLICY, holding("super_admin"), submit, {}).allowed
    ).toBe(true);
    expect(
      decide(
        SAFEGUARDING_POLICY,
        { kind: "system", process: "worker" },
        submit,
        {}
      ).allowed
    ).toBe(false);
  });
});

describe("the safeguarding lead role", () => {
  it("is one of FOA's own staff roles, so it needs a second factor", () => {
    expect(ROLES).toContain("safeguarding_lead");
    expect(isStaffRole("safeguarding_lead")).toBe(true);
  });

  it("is granted globally only", () => {
    expect(
      grantSchema.safeParse({
        role: "safeguarding_lead",
        scope: { type: "global" },
      }).success
    ).toBe(true);
    expect(
      grantSchema.safeParse({
        role: "safeguarding_lead",
        scope: { type: "institution", id: INSTITUTION },
      }).success
    ).toBe(false);
  });
});
