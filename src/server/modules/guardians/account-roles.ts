// What an account holds beyond being a member, as becoming a child's own
// login weighs it (#81): a guardian (declared, or the role) never becomes a
// child's login, and nor does a staff, school or judge account. Both the
// teen login invitation and the guardian request refuse them,
// so a teen's linked login never adds or manages other children.
//
// Read under the user's row lock: declaring, verifying and role grants
// take it too, so none of them slips past.

import { grantsOf } from "../../access/grants";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import { guardianOfUser } from "./guardian-record";

/**
 * Whether the user has declared as a guardian or holds the guardian role,
 * for any child.
 */
export async function isAGuardian(tx: AppDb, userId: string): Promise<boolean> {
  if (await guardianOfUser(tx, userId)) return true;
  const grants = await grantsOf(tx, userId);
  return grants.some((grant) => grant.role === "guardian");
}

/** Roles that don't keep an account from being a child's own login. */
const CHILD_LOGIN_ROLES: ReadonlySet<Role> = new Set<Role>([
  "member",
  "participant",
  // Refused on its own, with its own reason (isAGuardian).
  "guardian",
]);

/** Whether the user holds a staff, school, judge or other role. */
export async function holdsOtherRole(
  tx: AppDb,
  userId: string
): Promise<boolean> {
  const grants = await grantsOf(tx, userId);
  return grants.some((grant) => !CHILD_LOGIN_ROLES.has(grant.role));
}
