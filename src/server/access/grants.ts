// Reading and matching grants in `user_role`. Loads under plain Node (the
// bootstrap command): relative imports only, no "server-only".

import { and, eq, isNull, type SQL } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { userRole, type UserRole } from "../db/schema";
import { sortGrants, type Grant } from "./domain/roles";

/** A `user_role` row's grant: its role and scope, nothing else. */
export function grantOf(
  row: Pick<UserRole, "role" | "scopeType" | "scopeId">
): Grant {
  if (row.scopeType === "global") {
    return { role: row.role, scope: { type: "global" } };
  }
  if (row.scopeId === null) {
    throw new Error(`A ${row.scopeType} grant without a scope id`);
  }
  return { role: row.role, scope: { type: row.scopeType, id: row.scopeId } };
}

/** The grants `userId` holds right now, sorted (`sortGrants`). */
export async function grantsOf(db: AppDb, userId: string): Promise<Grant[]> {
  const rows = await db
    .select({
      role: userRole.role,
      scopeType: userRole.scopeType,
      scopeId: userRole.scopeId,
    })
    .from(userRole)
    .where(eq(userRole.userId, userId));
  return sortGrants(rows.map(grantOf));
}

/** The `user_role` row for this user and grant. */
export function grantRow(userId: string, grant: Grant): SQL {
  return and(
    eq(userRole.userId, userId),
    eq(userRole.role, grant.role),
    eq(userRole.scopeType, grant.scope.type),
    grant.scope.type === "global"
      ? isNull(userRole.scopeId)
      : eq(userRole.scopeId, grant.scope.id)
  )!;
}

/** The rows of global super admin grants. */
export const globalSuperAdminRows: SQL = and(
  eq(userRole.role, "super_admin"),
  eq(userRole.scopeType, "global"),
  isNull(userRole.scopeId)
)!;
