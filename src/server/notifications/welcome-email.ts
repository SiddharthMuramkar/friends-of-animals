// The welcome email, sent by the outbox handler
// notifications.send_welcome_email after identity.user_signed_up. Its words
// live in messages/en-IN/emails.json until #69 moves templates into the
// database.
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only", no Next imports (next-intl's createTranslator is plain).

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import emails from "../../../messages/en-IN/emails.json";
import type { AppDb } from "../db/app-db";
import { user } from "../db/schema";
import type { EmailMessage, EmailSender } from "../ports/email";

/** The welcome email for one account, worded from messages/en-IN. */
export function welcomeEmail(account: {
  name: string;
  email: string;
}): EmailMessage {
  const t = createTranslator({
    locale: "en-IN",
    messages: emails,
    namespace: "emails.welcome",
  });
  return {
    to: account.email,
    subject: t("subject"),
    text: t("text", { name: account.name }),
  };
}

/**
 * Sends the new account its welcome email. The event carries only the id,
 * so the address and name are read now; an account erased in the meantime
 * gets nothing, and the delivery still counts as done.
 */
export async function sendWelcomeEmail(
  deps: { db: AppDb; email: EmailSender },
  payload: { userId: string }
): Promise<void> {
  const [account] = await deps.db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, payload.userId));
  // An account signed up by phone (#58) has no address to welcome.
  if (!account?.email) return;
  await deps.email.send(welcomeEmail({ ...account, email: account.email }));
}
