// The invitation message (#74), sent by the outbox handler
// institutions.send_coordinator_invitation after
// institution.coordinator_invited: an email, or an SMS for a phone
// invitation. The event carries only the invitation's id; the address and
// the link's token are decrypted here, at send time. Words live in
// messages/en-IN/coordinators.json until #69 moves templates into the
// database.
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only", no Next imports (next-intl's createTranslator is plain).

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import coordinators from "../../../../messages/en-IN/coordinators.json";
import { formats, LOCALE } from "../../../i18n/formats";
import { invitationPath } from "../../../lib/app-routes";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import { institution, institutionInvitation, user } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { EmailSender } from "../../ports/email";
import type { SmsSender } from "../../ports/sms";
import { invitationStatus } from "../domain/invitation";
import { INVITATION_TOKEN, readInvitee } from "./invitee";

export type InvitationMessageDeps = {
  db: AppDb;
  clock: Clock;
  email: EmailSender;
  sms: SmsSender;
  cipher: FieldCipher;
  /** The site's base URL, for the link. */
  auth: { baseUrl: string };
};

/** When the link stops working, as the site writes deadlines (IST). */
function formatExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat(LOCALE, formats.dateTime.longDateTime).format(
    expiresAt
  );
}

const t = createTranslator({
  locale: "en-IN",
  messages: coordinators,
  namespace: "coordinators.invitationMessage",
});

/**
 * Sends one invitation's message. An invitation withdrawn, accepted or
 * expired before the outbox got to it gets nothing, and the delivery still
 * counts as done. Sending again (a retried delivery) sends the same link.
 */
export async function sendCoordinatorInvitation(
  deps: InvitationMessageDeps,
  payload: { invitationId: string }
): Promise<void> {
  const [row] = await deps.db
    .select({
      channel: institutionInvitation.channel,
      identifierCiphertext: institutionInvitation.identifierCiphertext,
      tokenCiphertext: institutionInvitation.tokenCiphertext,
      status: institutionInvitation.status,
      expiresAt: institutionInvitation.expiresAt,
      institutionName: institution.name,
      inviterName: user.name,
    })
    .from(institutionInvitation)
    .innerJoin(
      institution,
      eq(institution.id, institutionInvitation.institutionId)
    )
    .leftJoin(user, eq(user.id, institutionInvitation.invitedByUserId))
    .where(eq(institutionInvitation.id, payload.invitationId));
  if (
    !row?.tokenCiphertext ||
    invitationStatus(row, deps.clock.now()) !== "pending"
  ) {
    return;
  }

  const token = deps.cipher.decrypt(INVITATION_TOKEN, row.tokenCiphertext);
  const link = new URL(invitationPath(token), deps.auth.baseUrl).toString();
  const values = {
    institution: row.institutionName,
    inviter: row.inviterName ?? row.institutionName,
    link,
    expiresAt: formatExpiry(row.expiresAt),
  };
  const invitee = readInvitee(deps, row);
  if (invitee.channel === "email") {
    await deps.email.send({
      to: invitee.address,
      subject: t("subject", values),
      text: t("email", values),
    });
    return;
  }
  await deps.sms.send({
    to: invitee.address,
    template: "coordinator-invitation",
    vars: {
      institution: values.institution,
      expiresAt: values.expiresAt,
      link,
    },
    text: t("sms", values),
  });
}
