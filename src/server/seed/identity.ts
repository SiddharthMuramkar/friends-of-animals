// Identity seed data (#57, #58): accounts, member1 with a phone. Loads
// under plain Node (the seed script): relative imports only, no
// "server-only".

import { parsePhoneNumber, type E164Phone } from "../../lib/phone";
import { storedPhone } from "../identity/stored-phone";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

/** A seed's phone in E.164; throws for anything but an Indian mobile. */
export function seedPhone(typed: string): E164Phone {
  const parsed = parsePhoneNumber(typed);
  if (!parsed.ok) {
    throw new Error("A seed phone is not an Indian mobile number");
  }
  return parsed.e164;
}

/** The super admin and the members from SEED_ACCOUNTS. */
export async function seedIdentity(deps: SeedDeps): Promise<void> {
  await ensureVerifiedAccount(deps, SEED_ACCOUNTS.superAdmin);
  for (const member of SEED_ACCOUNTS.members) {
    await ensureVerifiedAccount(deps, {
      ...member,
      phone:
        "phone" in member
          ? storedPhone(deps, seedPhone(member.phone))
          : undefined,
    });
  }
}
