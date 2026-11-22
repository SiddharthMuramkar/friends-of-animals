import { describe, expect, it } from "vitest";

import { decide, type Subject } from "@/server/access/domain/policy";
import { ROLES, type Role } from "@/server/access/domain/roles";

import { FILES_POLICY, type FilesAction } from "./policy";

const USER = "01938a00-0000-7000-8000-000000000101";
const OTHER_USER = "01938a00-0000-7000-8000-000000000102";

const holding = (role: Role): Subject => ({
  kind: "user",
  userId: USER,
  grants: [{ role, scope: { type: "global" } }],
});

const plainUser: Subject = { kind: "user", userId: USER, grants: [] };

/** Every role that passes `action` on someone else's file. */
function rolesAllowed(action: FilesAction): Role[] {
  return ROLES.filter(
    (role) =>
      decide(FILES_POLICY, holding(role), action, { ownerId: OTHER_USER })
        .allowed
  );
}

describe("who may upload and read files", () => {
  it("lets any signed-in user upload, and no one else", () => {
    expect(decide(FILES_POLICY, plainUser, "file.upload")).toEqual({
      allowed: true,
      role: null,
    });
    expect(
      decide(FILES_POLICY, { kind: "visitor" }, "file.upload").allowed
    ).toBe(false);
    expect(
      decide(FILES_POLICY, { kind: "system", process: "worker" }, "file.upload")
        .allowed
    ).toBe(false);
  });

  it("lets only the uploader complete an upload, whatever roles others hold", () => {
    expect(
      decide(FILES_POLICY, plainUser, "file.complete", { ownerId: USER })
    ).toEqual({ allowed: true, role: null });
    expect(rolesAllowed("file.complete")).toEqual([]);
  });

  it("lets the uploader read, and of all roles only staff and super admins", () => {
    expect(
      decide(FILES_POLICY, plainUser, "file.read", { ownerId: USER })
    ).toEqual({ allowed: true, role: null });
    expect(rolesAllowed("file.read").sort()).toEqual([
      "staff_admin",
      "super_admin",
    ]);
  });

  it("reports a staff read by its role, so it can be audited", () => {
    expect(
      decide(FILES_POLICY, holding("staff_admin"), "file.read", {
        ownerId: OTHER_USER,
      })
    ).toEqual({ allowed: true, role: "staff_admin" });
  });

  it("never lets a visitor or the platform itself read a file", () => {
    for (const subject of [
      { kind: "visitor" },
      { kind: "system", process: "worker" },
      { kind: "system", process: "cli" },
    ] as const) {
      expect(
        decide(FILES_POLICY, subject, "file.read", { ownerId: USER }).allowed
      ).toBe(false);
    }
  });
});
