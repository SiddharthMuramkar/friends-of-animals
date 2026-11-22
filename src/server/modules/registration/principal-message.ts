// The principal's message (#75), sent by the outbox handler
// registration.notify_principal after registration.institution_registered:
// an email to the institution's principal naming the institution, the
// competition, the reference and who registered. The principal is a
// contact on the institution (#73), not a user, so #69's route rows can't
// name them; the event carries only the registration's id, and the
// principal's address is decrypted here, at send time. Email only: SMS
// waits for registered DLT templates (HR-14).
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only", no Next imports (next-intl's createTranslator is plain).

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import institutionRegistrationMessages from "../../../../messages/en-IN/institutionRegistration.json";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  institution,
  institutionRegistration,
  user,
} from "../../db/schema";
import type { EmailSender } from "../../ports/email";
import { PRINCIPAL_EMAIL } from "../institutions/principal-contact";

export type PrincipalMessageDeps = {
  db: AppDb;
  email: EmailSender;
  cipher: FieldCipher;
};

const t = createTranslator({
  locale: "en-IN",
  messages: institutionRegistrationMessages,
  namespace: "institutionRegistration.principalMessage",
});

/**
 * Emails the principal about one registration. A retried delivery sends
 * the same message again; a registration that no longer exists gets none.
 */
export async function notifyPrincipal(
  deps: PrincipalMessageDeps,
  payload: { institutionRegistrationId: string }
): Promise<void> {
  const [row] = await deps.db
    .select({
      reference: institutionRegistration.reference,
      institutionName: institution.name,
      principalName: institution.principalName,
      principalEmailCiphertext: institution.principalEmailCiphertext,
      competitionName: competition.name,
      registeredByName: user.name,
    })
    .from(institutionRegistration)
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .innerJoin(
      competition,
      eq(competition.id, institutionRegistration.competitionId)
    )
    .leftJoin(user, eq(user.id, institutionRegistration.registeredBy))
    .where(eq(institutionRegistration.id, payload.institutionRegistrationId));
  if (!row) return;

  const values = {
    principal: row.principalName,
    institution: row.institutionName,
    competition: row.competitionName,
    reference: row.reference,
    coordinator: row.registeredByName ?? t("someone"),
  };
  await deps.email.send({
    to: deps.cipher.decrypt(PRINCIPAL_EMAIL, row.principalEmailCiphertext),
    subject: t("subject", values),
    text: t("email", values),
  });
}
