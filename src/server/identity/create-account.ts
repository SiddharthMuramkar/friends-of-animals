// Creating an account. FOA does it, not Better Auth, so the account and
// its identity.user_signed_up event are saved in one transaction: Better
// Auth 1.7 runs its after-create hooks once its own write has committed,
// and its Drizzle adapter writes outside any transaction, so neither could
// make the event exist if and only if the account does. Better Auth's
// email-OTP plugin runs with `disableSignUp`, so it never creates one.

import type { DbWithClock } from "../db/app-db";
import { user } from "../db/schema";
import { uuidv7 } from "../ids";
import { emit } from "../outbox";

/**
 * Creates a verified account for `email` (already normalised) and emits
 * identity.user_signed_up with it. Returns false, creating and emitting
 * nothing, if the address got an account meanwhile.
 */
export async function createAccount(
  { db, clock }: DbWithClock,
  input: { email: string; name: string }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const [created] = await tx
      .insert(user)
      .values({
        id: uuidv7(now),
        name: input.name,
        email: input.email,
        // Only someone holding the emailed code gets this far.
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    if (!created) return false;
    await emit(tx, clock, {
      type: "identity.user_signed_up",
      aggregate: { type: "user", id: created.id },
      payload: { userId: created.id },
    });
    return true;
  });
}
