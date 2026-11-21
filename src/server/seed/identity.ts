// Identity seed data (#57): accounts. Loads under plain Node (the seed
// script): relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { parsePhoneNumber, type E164Phone } from "../../lib/phone";
import { user, type User } from "../db/schema";
import { storedPhone } from "../identity/stored-phone";
import { uuidv7 } from "../ids";
import { normaliseEmailAddress } from "../ports/email";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

/** A seeded account: it always has an email address. */
export type SeededUser = User & { email: string };

export type AccountInput = {
  id?: string;
  name: string;
  email: string;
  /** Verified, stored encrypted. */
  phone?: E164Phone | undefined;
};

/**
 * Creates a verified account, or returns the one that already has this
 * address untouched, so seeding again (or after someone signed up with a
 * seeded address) changes nothing. If another account already holds the
 * phone (someone signed up with it), this one is made without it.
 */
export async function ensureAccount(
  deps: SeedDeps,
  input: AccountInput
): Promise<SeededUser> {
  const { db, clock } = deps;
  const now = clock.now();
  const email = normaliseEmailAddress(input.email);
  const [created] = await db
    .insert(user)
    .values({
      id: input.id ?? uuidv7(now),
      name: input.name,
      email,
      emailVerified: true,
      ...(input.phone
        ? { ...storedPhone(deps, input.phone), phoneVerified: true }
        : {}),
      createdAt: now,
      updatedAt: now,
    })
    // The address or the phone may be taken; which one is checked below.
    .onConflictDoNothing()
    .returning();
  if (created) return { ...created, email };
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) return { ...existing, email };
  if (input.phone) return ensureAccount(deps, { ...input, phone: undefined });
  throw new Error(`Could not create or find ${email}`);
}

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
  await ensureAccount(deps, SEED_ACCOUNTS.superAdmin);
  for (const member of SEED_ACCOUNTS.members) {
    await ensureAccount(deps, {
      ...member,
      phone: "phone" in member ? seedPhone(member.phone) : undefined,
    });
  }
}
