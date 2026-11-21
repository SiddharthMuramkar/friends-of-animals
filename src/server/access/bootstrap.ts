// The first super admin (#59). Only a super admin grants roles, so the
// first one comes from the operator's command line
// (`pnpm admin:bootstrap-super-admin`), acting as the platform. It goes
// through grantRole like any grant, so the audit log records it, and it
// works only while there is no global super admin: later ones are granted
// in the app. Loads under plain Node: relative imports only, no
// "server-only".

import { sql } from "drizzle-orm";

import type { Actor } from "../actor";
import type { DbWithClock } from "../db/app-db";
import { userRole } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { globalSuperAdminRows } from "./grants";
import { grantRole } from "./manage-roles";

const COMMAND_LINE: Actor = { kind: "system", process: "cli" };

export type BootstrapResult =
  | { ok: true; userId: string }
  | { ok: false; error: "super_admin_exists" };

/**
 * Makes the account with this address the first global super admin,
 * creating a verified account if there is none (an existing account keeps
 * its name). One transaction: refused, or failing, it writes nothing.
 */
export async function bootstrapSuperAdmin(
  { db, clock }: DbWithClock,
  account: { email: string; name: string }
): Promise<BootstrapResult> {
  return db.transaction(async (tx) => {
    // Until commit, no one else changes grants: a second bootstrap at the
    // same moment waits here, then finds this one's super admin.
    await tx.execute(sql`lock table ${userRole} in share row exclusive mode`);
    const [existing] = await tx
      .select({ id: userRole.id })
      .from(userRole)
      .where(globalSuperAdminRows)
      .limit(1);
    if (existing) return { ok: false, error: "super_admin_exists" } as const;

    const { id: userId } = await ensureVerifiedAccount(
      { db: tx, clock },
      account
    );
    const granted = await grantRole(
      { db: tx, clock, actor: COMMAND_LINE },
      { userId, role: "super_admin", scope: { type: "global" } }
    );
    if (!granted.ok || !granted.changed) {
      throw new Error(
        `Could not grant super admin: ${granted.ok ? "unchanged" : granted.error}`
      );
    }
    return { ok: true, userId } as const;
  });
}
