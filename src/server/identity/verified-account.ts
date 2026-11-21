// Making an account without a sign-up: for seed data and for the operator's
// bootstrap command. Loads under plain Node (the seed script, the bootstrap
// command): relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { DbWithClock } from "../db/app-db";
import { user, type User } from "../db/schema";
import { uuidv7 } from "../ids";
import { normaliseEmailAddress } from "../ports/email";

export type AccountInput = { id?: string; name: string; email: string };

/**
 * Creates a verified account, or returns the one that already has this
 * address untouched, so running again (or after someone signed up with the
 * address) changes nothing.
 */
export async function ensureVerifiedAccount(
  { db, clock }: DbWithClock,
  input: AccountInput
): Promise<User> {
  const now = clock.now();
  const email = normaliseEmailAddress(input.email);
  const [created] = await db
    .insert(user)
    .values({
      id: input.id ?? uuidv7(now),
      name: input.name,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: user.email })
    .returning();
  if (created) return created;
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  // No address in the message: errors reach logs.
  if (!existing) throw new Error("Could not create or find the account");
  return existing;
}
