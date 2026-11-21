// Creating an account. FOA does it, not Better Auth, so the account and
// its identity.user_signed_up event are saved in one transaction: Better
// Auth 1.7 runs its after-create hooks once its own write has committed,
// and its Drizzle adapter writes outside any transaction, so neither could
// make the event exist if and only if the account does. Better Auth's
// email-OTP plugin runs with `disableSignUp`, so it never creates one.

import type { Ciphertext } from "../crypto/field-cipher";
import type { DbWithClock } from "../db/app-db";
import { user } from "../db/schema";
import { uuidv7 } from "../ids";
import { emit } from "../outbox";

/** How the account is reached: an email address, or a stored phone (#58). */
export type NewAccount =
  | { name: string; email: string }
  | {
      name: string;
      phone: { phoneCiphertext: Ciphertext; phoneHash: string };
    };

/**
 * Creates a verified account for `email` (already normalised), or for a
 * phone (./stored-phone.ts), and emits identity.user_signed_up with it.
 * Returns false, creating and emitting nothing, if the address or phone
 * got an account meanwhile.
 */
export async function createAccount(
  { db, clock }: DbWithClock,
  input: NewAccount
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = clock.now();
    const values = {
      id: uuidv7(now),
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
    // Only someone holding the emailed or texted code gets this far.
    const [created] = await (
      "email" in input
        ? tx
            .insert(user)
            .values({ ...values, email: input.email, emailVerified: true })
            .onConflictDoNothing({ target: user.email })
        : tx
            .insert(user)
            .values({
              ...values,
              email: null,
              ...input.phone,
              phoneVerified: true,
            })
            .onConflictDoNothing({ target: user.phoneHash })
    ).returning({ id: user.id });
    if (!created) return false;
    await emit(tx, clock, {
      type: "identity.user_signed_up",
      aggregate: { type: "user", id: created.id },
      payload: { userId: created.id },
    });
    return true;
  });
}
