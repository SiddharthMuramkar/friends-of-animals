import { describe, expect, it } from "vitest";

import { ACCESS_POLICY } from "./access-policy";
import { anyOf, decide, role, stepUp, system, type Subject } from "./policy";

const superAdmin: Subject = {
  kind: "user",
  userId: "01938a00-0000-7000-8000-000000000001",
  grants: [{ role: "super_admin", scope: { type: "global" } }],
};
const member: Subject = { ...superAdmin, grants: [] };

describe("stepUp", () => {
  const rule = stepUp(anyOf(role("super_admin"), system("cli")));

  it("asks a signed-in user it allows for a fresh second factor", () => {
    expect(rule(superAdmin, {})).toEqual({
      allowed: true,
      role: "super_admin",
      stepUp: true,
    });
  });

  it("doesn't ask the platform's own processes, which have no second factor", () => {
    expect(rule({ kind: "system", process: "cli" }, {})).toEqual({
      allowed: true,
      role: null,
    });
  });

  it("leaves a refusal a refusal", () => {
    expect(rule(member, {})).toEqual({ allowed: false });
  });

  it("marks granting and revoking roles", () => {
    for (const action of ["role.grant", "role.revoke"] as const) {
      expect(decide(ACCESS_POLICY, superAdmin, action)).toMatchObject({
        stepUp: true,
      });
    }
    expect(decide(ACCESS_POLICY, superAdmin, "user.search")).toEqual({
      allowed: true,
      role: "super_admin",
    });
  });
});
