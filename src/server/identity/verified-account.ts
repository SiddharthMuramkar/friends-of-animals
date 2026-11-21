// Making an account without a sign-up: for seed data and for the operator's
// bootstrap command. Loads under plain Node (the seed script, the bootstrap
// command): relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { Ciphertext } from "../crypto/field-cipher";
import type { DbWithClock } from "../db/app-db";
import { user, type User } from "../db/schema";
import { uuidv7 } from "../ids";
import { normaliseEmailAddress } from "../ports/email";

export type AccountInput = {
  id?: string;
  name: string;
  email: string;
  /** A verified phone, already stored (./stored-phone.ts). */
  phone?: { phoneCiphertext: Ciphertext; phoneHash: string } | undefined;
};

/** An account made here: it always has an email address. */
export type VerifiedAccount = User & { email: string };

/**
 * Creates a verified account, or returns the one that already has this
 * address untouched, so running again (or after someone signed up with the
 * address) changes nothing. If another account already holds the phone
 * (someone signed up with it), this one is made without it.
 */
export async function ensureVerifiedAccount(
  deps: DbWithClock,
  input: AccountInput
): Promise<VerifiedAccount> {
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
      ...(input.phone ? { ...input.phone, phoneVerified: true } : {}),
      createdAt: now,
      updatedAt: now,
    })
    // The address or the phone may be taken; which one is checked below.
    .onConflictDoNothing()
    .returning();
  if (created) return { ...created, email };
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) return { ...existing, email };
  if (input.phone) {
    return ensureVerifiedAccount(deps, { ...input, phone: undefined });
  }
  // No address in the message: errors reach logs.
  throw new Error("Could not create or find the account");
}
