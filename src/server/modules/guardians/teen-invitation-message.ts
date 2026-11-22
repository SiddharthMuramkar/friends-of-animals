// The teen-login invitation message (#81), sent by the outbox handler
// guardians.send_teen_invitation after guardian.teen_invited: an email to
// the invited address. The event carries only the invitation's id; the
// address, the names and the link's token are decrypted here, at send
// time. Words live in messages/en-IN/guardian.json.
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only", no Next imports (next-intl's createTranslator is plain).

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import guardianMessages from "../../../../messages/en-IN/guardian.json";
import { formats, LOCALE } from "../../../i18n/formats";
import { invitationPath } from "../../../lib/app-routes";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  guardian,
  guardianInvitation,
  participantProfile,
} from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { EmailSender } from "../../ports/email";
import { invitationStatus } from "../institutions/domain/invitation";
import { guardianName } from "./guardian-record";
import { readTeenContact, TEEN_INVITATION_TOKEN } from "./teen-contact";

export type TeenInvitationMessageDeps = {
  db: AppDb;
  clock: Clock;
  email: EmailSender;
  cipher: FieldCipher;
  /** The site's base URL, for the link; a worker without APP_URL has none. */
  auth: { baseUrl?: string | undefined };
};

const t = createTranslator({
  locale: "en-IN",
  messages: guardianMessages,
  namespace: "guardian.teenInvitationMessage",
});

/**
 * Sends one invitation's message. An invitation withdrawn, accepted or
 * expired before the outbox got to it gets nothing, and the delivery still
 * counts as done. Sending again (a retried delivery) sends the same link.
 */
export async function sendTeenInvitation(
  deps: TeenInvitationMessageDeps,
  payload: { invitationId: string }
): Promise<void> {
  const [row] = await deps.db
    .select({
      channel: guardianInvitation.channel,
      contactCiphertext: guardianInvitation.contactCiphertext,
      tokenCiphertext: guardianInvitation.tokenCiphertext,
      status: guardianInvitation.status,
      expiresAt: guardianInvitation.expiresAt,
      fullNameCiphertext: guardian.fullNameCiphertext,
      childName: participantProfile.fullName,
    })
    .from(guardianInvitation)
    .innerJoin(guardian, eq(guardian.id, guardianInvitation.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianInvitation.participantProfileId)
    )
    .where(eq(guardianInvitation.id, payload.invitationId));
  if (
    !row?.tokenCiphertext ||
    invitationStatus(row, deps.clock.now()) !== "pending"
  ) {
    return;
  }
  if (!deps.auth.baseUrl) {
    // Thrown, so the outbox retries once the worker has APP_URL.
    throw new Error(
      `Teen invitation ${payload.invitationId} needs the site's base URL ` +
        "(APP_URL) for its link"
    );
  }
  const contact = readTeenContact(deps, row);
  if (contact.channel !== "email") {
    // Phone invitations wait for their SMS template (HR-14).
    throw new Error(
      `Teen invitation ${payload.invitationId} has no way to send by ${contact.channel}`
    );
  }
  const token = deps.cipher.decrypt(TEEN_INVITATION_TOKEN, row.tokenCiphertext);
  const values = {
    child: row.childName,
    guardian: guardianName(deps, row),
    link: new URL(invitationPath(token), deps.auth.baseUrl).toString(),
    expiresAt: new Intl.DateTimeFormat(
      LOCALE,
      formats.dateTime.longDateTime
    ).format(row.expiresAt),
  };
  await deps.email.send({
    to: contact.address,
    subject: t("subject"),
    text: t("email", values),
  });
}
