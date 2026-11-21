import { describe, expect, it } from "vitest";

import {
  anyOf,
  composePolicies,
  decide,
  owner,
  role,
  signedIn,
  signedOut,
  system,
  type Policy,
  type Subject,
} from "./policy";
import type { Grant } from "./roles";

const INST_A = "01938a00-0000-7000-8000-00000000a001";
const INST_B = "01938a00-0000-7000-8000-00000000a002";
const COMP_A = "01938a00-0000-7000-8000-00000000c001";
const USER = "01938a00-0000-7000-8000-000000000101";
const OTHER_USER = "01938a00-0000-7000-8000-000000000102";

const policy = {
  "institution.edit": role("institution_admin", "staff_admin"),
  "profile.edit": anyOf(owner, role("staff_admin")),
  "role.grant": anyOf(role("super_admin"), system("cli")),
  "dashboard.view": signedIn,
} satisfies Policy<string>;

const user = (...grants: Grant[]): Subject => ({
  kind: "user",
  userId: USER,
  grants,
});
const visitor: Subject = { kind: "visitor" };

const globalStaffAdmin: Grant = {
  role: "staff_admin",
  scope: { type: "global" },
};
const adminOfA: Grant = {
  role: "institution_admin",
  scope: { type: "institution", id: INST_A },
};
const inA = { scopes: [{ type: "institution", id: INST_A }] } as const;
const inB = { scopes: [{ type: "institution", id: INST_B }] } as const;

describe("decide", () => {
  it("lets a global role act on any target, scoped or not", () => {
    const subject = user(globalStaffAdmin);
    for (const resource of [inA, inB, {}]) {
      expect(decide(policy, subject, "institution.edit", resource)).toEqual({
        allowed: true,
        role: "staff_admin",
      });
    }
  });

  it("lets a scoped role act inside its own scope", () => {
    expect(decide(policy, user(adminOfA), "institution.edit", inA)).toEqual({
      allowed: true,
      role: "institution_admin",
    });
  });

  it("refuses a scoped role on another id of the same scope type", () => {
    expect(decide(policy, user(adminOfA), "institution.edit", inB)).toEqual({
      allowed: false,
    });
  });

  it("refuses a scoped role on a target in another scope type with the same id", () => {
    const competitionWithSameId = {
      scopes: [{ type: "competition", id: INST_A }],
    } as const;
    expect(
      decide(policy, user(adminOfA), "institution.edit", competitionWithSameId)
    ).toEqual({ allowed: false });
  });

  it("refuses a scoped role on a target with no scope", () => {
    expect(decide(policy, user(adminOfA), "institution.edit", {})).toEqual({
      allowed: false,
    });
  });

  it("matches any of the scopes a target sits in", () => {
    const entryInAAndCompetition = {
      scopes: [
        { type: "competition", id: COMP_A },
        { type: "institution", id: INST_A },
      ],
    } as const;
    expect(
      decide(policy, user(adminOfA), "institution.edit", entryInAAndCompetition)
        .allowed
    ).toBe(true);
  });

  it("refuses a role the rule doesn't name, whatever its scope", () => {
    const globalFinance: Grant = { role: "finance", scope: { type: "global" } };
    expect(
      decide(policy, user(globalFinance), "institution.edit", inA)
    ).toEqual({ allowed: false });
  });

  it("reports the first role the rule names that covers the target", () => {
    const decision = decide(
      policy,
      user(adminOfA, globalStaffAdmin),
      "institution.edit",
      inA
    );
    expect(decision).toEqual({ allowed: true, role: "institution_admin" });

    const both = user(
      { role: "institution_admin", scope: { type: "global" } },
      adminOfA
    );
    expect(decide(policy, both, "institution.edit", inA)).toEqual({
      allowed: true,
      role: "institution_admin",
    });
  });

  it("lets a user act on what they own, with no role", () => {
    expect(decide(policy, user(), "profile.edit", { ownerId: USER })).toEqual({
      allowed: true,
      role: null,
    });
    expect(
      decide(policy, user(), "profile.edit", { ownerId: OTHER_USER })
    ).toEqual({ allowed: false });
  });

  it("lets the system act only as the processes a rule names", () => {
    expect(
      decide(policy, { kind: "system", process: "cli" }, "role.grant", {})
    ).toEqual({ allowed: true, role: null });
    expect(
      decide(policy, { kind: "system", process: "worker" }, "role.grant", {})
    ).toEqual({ allowed: false });
  });

  it("refuses a visitor everything but the rules open to them", () => {
    for (const action of Object.keys(policy) as (keyof typeof policy)[]) {
      expect(decide(policy, visitor, action, { ownerId: USER })).toEqual({
        allowed: false,
      });
    }
  });

  it("lets any signed-in user pass signedIn, and nobody else", () => {
    expect(decide(policy, user(), "dashboard.view", {}).allowed).toBe(true);
    expect(decide(policy, visitor, "dashboard.view", {}).allowed).toBe(false);
    expect(
      decide(policy, { kind: "system", process: "seed" }, "dashboard.view", {})
        .allowed
    ).toBe(false);
  });

  it("lets only a signed-out caller pass signedOut", () => {
    const signUp = { "session.start": signedOut } satisfies Policy<string>;
    expect(decide(signUp, visitor, "session.start")).toEqual({
      allowed: true,
      role: null,
    });
    expect(decide(signUp, user(globalStaffAdmin), "session.start")).toEqual({
      allowed: false,
    });
    expect(
      decide(signUp, { kind: "system", process: "seed" }, "session.start")
    ).toEqual({ allowed: false });
  });

  it("refuses an action the policy doesn't define", () => {
    expect(
      decide(policy, user(globalStaffAdmin), "unknown" as "role.grant", {})
    ).toEqual({ allowed: false });
  });
});

describe("composePolicies", () => {
  it("merges policies into one that decides each action by its own rule", () => {
    const identity = { "session.start": signedOut } satisfies Policy<string>;
    const access = {
      "role.grant": role("super_admin"),
    } satisfies Policy<string>;
    const platform = composePolicies(identity, access);

    expect(decide(platform, visitor, "session.start")).toEqual({
      allowed: true,
      role: null,
    });
    expect(
      decide(
        platform,
        user({ role: "super_admin", scope: { type: "global" } }),
        "role.grant"
      )
    ).toEqual({ allowed: true, role: "super_admin" });
    expect(decide(platform, visitor, "role.grant")).toEqual({ allowed: false });
  });

  it("throws when two policies define the same action", () => {
    expect(() =>
      composePolicies(
        { "dashboard.view": signedIn },
        // @ts-expect-error two policies define "dashboard.view"
        { "dashboard.view": signedOut }
      )
    ).toThrow('Action "dashboard.view" is defined in more than one policy');
  });
});
