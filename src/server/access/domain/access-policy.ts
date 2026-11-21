// Who may manage roles and read access (#59). Only a super admin grants or
// revokes; the operator's command line may too, so the first production
// super admin can be bootstrapped (`pnpm admin:bootstrap-super-admin`).
// Staff admins read roles, users and the audit log.

import { anyOf, owner, role, signedIn, system, type Policy } from "./policy";

export const ACCESS_POLICY = {
  "role.grant": anyOf(role("super_admin"), system("cli")),
  "role.revoke": anyOf(role("super_admin"), system("cli")),
  /** A user's roles: theirs, or anyone's for staff who manage access. */
  "role.list": anyOf(owner, role("super_admin", "staff_admin")),
  "user.search": role("super_admin", "staff_admin"),
  "audit.search": role("super_admin", "staff_admin"),
  /** The signed-in user's own roles and dashboards. */
  "access.view-own": signedIn,
} satisfies Policy<string>;

export type AccessAction = keyof typeof ACCESS_POLICY;
