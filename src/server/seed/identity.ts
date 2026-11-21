// Identity seed data (#57): accounts. Loads under plain Node (the seed
// script): relative imports only, no "server-only".

import { ensureVerifiedAccount } from "../identity/verified-account";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

/** The super admin and the members from SEED_ACCOUNTS. */
export async function seedIdentity(deps: SeedDeps): Promise<void> {
  await ensureVerifiedAccount(deps, SEED_ACCOUNTS.superAdmin);
  for (const member of SEED_ACCOUNTS.members) {
    await ensureVerifiedAccount(deps, member);
  }
}
