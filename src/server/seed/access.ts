// Access seed data (#59): grants, so previews have a super admin, a staff
// admin and a member with several roles across scopes. Loads under plain
// Node (the seed script): relative imports only, no "server-only".

import type { Grant } from "../access/domain/roles";
import { userRole } from "../db/schema";
import { uuidv7 } from "../ids";
import { SEED_ACCOUNTS } from "./accounts";
import { ensureAccount } from "./identity";
import { SEED_SCOPES } from "./scopes";
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

const [asha, ravi] = SEED_ACCOUNTS.members;

/** Who holds what in a preview. The third member holds nothing. */
const SEED_GRANTS: ReadonlyArray<{
  account: { name: string; email: string };
  grants: Grant[];
}> = [
  {
    account: SEED_ACCOUNTS.superAdmin,
    grants: [{ role: "super_admin", scope: { type: "global" } }],
  },
  {
    // One account, several dashboards: admin, a school and judging.
    account: asha,
    grants: [
      { role: "content_manager", scope: { type: "global" } },
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: SEED_SCOPES.institution.id },
      },
      {
        role: "judge",
        scope: { type: "competition", id: SEED_SCOPES.competition.id },
      },
    ],
  },
  {
    account: ravi,
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
  },
];

/** The grants in SEED_GRANTS, after seedIdentity has made the accounts. */
export async function seedAccess(deps: SeedDeps): Promise<void> {
  for (const { account, grants } of SEED_GRANTS) {
    // By address, not by the fixed id: someone may have signed up with a
    // seeded address before the seed ran, and keeps their own id.
    const { id } = await ensureAccount(deps, account);
    for (const grant of grants) await ensureGrant(deps, id, grant);
  }
}
