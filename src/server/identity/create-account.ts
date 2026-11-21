// Creating an account. FOA does it, not Better Auth, so the account, its
// identity.user_signed_up event and any consent ticked on the sign-up form
// (#64) are saved in one transaction: Better Auth 1.7 runs its after-create
// hooks once its own write has committed, and its Drizzle adapter writes
// outside any transaction, so neither could make the event exist if and
// only if the account does. Better Auth's email-OTP plugin runs with
// `disableSignUp`, so it never creates one.

import { recordSignUpConsent, type SignUpConsentOutcome } from "../consent";
import { user } from "../db/schema";
import { uuidv7 } from "../ids";
import { emit } from "../outbox";
import type { UseCaseContext } from "../use-cases";

export type CreatedAccount =
  | { created: false }
  | { created: true; messagesConsent?: SignUpConsentOutcome };

/**
 * Creates a verified account for `email` (already normalised) and emits
 * identity.user_signed_up with it. `messagesConsent` is the id of the
 * messages consent document the form showed, when its box was ticked.
 * Creates, emits and records nothing if the address got an account
 * meanwhile.
 */
export async function createAccount(
  ctx: Pick<UseCaseContext, "db" | "clock" | "actor">,
  input: { email: string; name: string; messagesConsent?: string }
): Promise<CreatedAccount> {
  const { db, clock } = ctx;
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
