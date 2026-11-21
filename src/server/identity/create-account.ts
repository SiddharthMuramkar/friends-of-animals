// Creating an account. FOA does it, not Better Auth, so the account, its
// identity.user_signed_up event and any consent ticked on the sign-up form
// (#64) are saved in one transaction: Better Auth 1.7 runs its after-create
// hooks once its own write has committed, and its Drizzle adapter writes
// outside any transaction, so neither could make the event exist if and
// only if the account does. Better Auth's email-OTP plugin runs with
// `disableSignUp`, so it never creates one.

import type { Ciphertext } from "../crypto/field-cipher";
import {
  recordSignUpConsent,
  type SignUpConsentOutcome,
} from "../modules/consent";
import { user } from "../db/schema";
import { uuidv7 } from "../ids";
import { emit } from "../outbox";
import type { UseCaseContext } from "../use-cases";

/** How the account is reached: an email address, or a stored phone (#58). */
export type NewAccount =
  | { name: string; email: string }
  | {
      name: string;
      phone: { phoneCiphertext: Ciphertext; phoneHash: string };
    };

export type CreatedAccount =
  | { created: false }
  | { created: true; messagesConsent?: SignUpConsentOutcome };

/**
 * Creates a verified account for `email` (already normalised), or for a
 * phone (./stored-phone.ts), and emits identity.user_signed_up with it.
 * `messagesConsent` is the id of the messages consent document the form
 * showed, when its box was ticked. Creates, emits and records nothing if
 * the address or phone got an account meanwhile.
 */
export async function createAccount(
  ctx: Pick<UseCaseContext, "db" | "clock" | "actor">,
  input: NewAccount & { messagesConsent?: string }
): Promise<CreatedAccount> {
  const { db, clock } = ctx;
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
    if (!created) return { created: false } as const;
    await emit(tx, clock, {
      type: "identity.user_signed_up",
      aggregate: { type: "user", id: created.id },
      payload: { userId: created.id },
    });
    if (input.messagesConsent === undefined) return { created: true } as const;
    const messagesConsent = await recordSignUpConsent(tx, ctx, {
      userId: created.id,
      purpose: "messages",
      documentId: input.messagesConsent,
    });
    return { created: true, messagesConsent } as const;
  });
}
