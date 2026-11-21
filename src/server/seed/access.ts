// Access seed data (#59): grants. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import type { Grant } from "../access/domain/roles";
import { userRole } from "../db/schema";
import { uuidv7 } from "../ids";
import type { SeedDeps } from "./types";

/**
 * Gives `userId` the grant unless they already hold it. Seed data, not an
 * admin's change: it writes no audit entry and names no granting user.
 */
export async function ensureGrant(
  { db, clock }: SeedDeps,
  userId: string,
  grant: Grant
): Promise<void> {
  const now = clock.now();
  await db
    .insert(userRole)
    .values({
      id: uuidv7(now),
      userId,
      role: grant.role,
      scopeType: grant.scope.type,
      scopeId: grant.scope.type === "global" ? null : grant.scope.id,
      grantedAt: now,
    })
    .onConflictDoNothing();
}
