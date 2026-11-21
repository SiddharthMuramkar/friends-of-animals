// The first super admin (#59). Only a super admin grants roles, so the
// first one comes from the operator's command line
// (`pnpm admin:bootstrap-super-admin`), acting as the platform. It goes
// through grantRole like any grant, so the audit log records it. Loads
// under plain Node: relative imports only, no "server-only".

import type { Actor } from "../actor";
import type { DbWithClock } from "../db/app-db";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { grantRole } from "./manage-roles";

const COMMAND_LINE: Actor = { kind: "system", process: "cli" };

/**
 * Makes the account with this address a global super admin, creating a
 * verified account first if there is none. An existing account keeps its
 * name. `changed` is false when it already was one.
 */
export async function bootstrapSuperAdmin(
  deps: DbWithClock,
  account: { email: string; name: string }
): Promise<{ userId: string; changed: boolean }> {
  const { id: userId } = await ensureVerifiedAccount(deps, account);
  const result = await grantRole(
    { ...deps, actor: COMMAND_LINE },
    { userId, role: "super_admin", scope: { type: "global" } }
  );
  if (!result.ok) {
    throw new Error(`Could not grant super admin: ${result.error}`);
  }
  return { userId, changed: result.changed };
}
