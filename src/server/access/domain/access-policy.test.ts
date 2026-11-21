import { describe, expect, it } from "vitest";

import { ACCESS_POLICY, type AccessAction } from "./access-policy";
import { decide, type Subject } from "./policy";
import { ROLES, type Grant, type Role } from "./roles";

const USER = "01938a00-0000-7000-8000-000000000101";
const OTHER_USER = "01938a00-0000-7000-8000-000000000102";

const holding = (role: Role): Subject => ({
  kind: "user",
  userId: USER,
  grants: [{ role, scope: { type: "global" } } satisfies Grant],
});

/** Every role that passes `action` on a target owned by someone else. */
function rolesAllowed(action: AccessAction): Role[] {
  return ROLES.filter(
    (role) =>
      decide(ACCESS_POLICY, holding(role), action, { ownerId: OTHER_USER })
        .allowed
  );
}

describe("who may manage and read access", () => {
  it.each([
    ["role.grant", ["super_admin"]],
    ["role.revoke", ["super_admin"]],
    ["role.list", ["staff_admin", "super_admin"]],
    ["user.search", ["staff_admin", "super_admin"]],
    ["audit.search", ["staff_admin", "super_admin"]],
  ] as const)("%s: only %j", (action, roles) => {
    expect(rolesAllowed(action).sort()).toEqual([...roles].sort());
  });

  it("lets every signed-in user see their own access, and only theirs", () => {
    expect(rolesAllowed("access.view-own")).toEqual([...ROLES]);
    expect(
      decide(ACCESS_POLICY, { kind: "visitor" }, "access.view-own", {}).allowed
    ).toBe(false);
  });

  it("lets a user list their own roles without a staff role", () => {
    const plain: Subject = { kind: "user", userId: USER, grants: [] };
    expect(
      decide(ACCESS_POLICY, plain, "role.list", { ownerId: USER }).allowed
    ).toBe(true);
    expect(
      decide(ACCESS_POLICY, plain, "role.list", { ownerId: OTHER_USER }).allowed
    ).toBe(false);
  });

  it("lets the operator's command line grant and revoke, and no other process", () => {
    for (const action of ["role.grant", "role.revoke"] as const) {
      expect(
        decide(ACCESS_POLICY, { kind: "system", process: "cli" }, action, {})
      ).toEqual({ allowed: true, role: null });
      for (const process of ["seed", "worker"] as const) {
        expect(
          decide(ACCESS_POLICY, { kind: "system", process }, action, {}).allowed
        ).toBe(false);
      }
    }
  });

  it("refuses a visitor every access action", () => {
    for (const action of Object.keys(ACCESS_POLICY) as AccessAction[]) {
      expect(
        decide(ACCESS_POLICY, { kind: "visitor" }, action, { ownerId: USER })
          .allowed
      ).toBe(false);
    }
  });
});
