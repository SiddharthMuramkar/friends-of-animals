// The guardian request message (#81), sent by the outbox handler
// guardians.send_guardian_request after guardian.guardian_requested: an
// email to the address a teen gave for their parent or guardian. The event
// carries only the request's id; the address, the names and the link's
// token are decrypted here, at send time. Words live in
// messages/en-IN/guardian.json.
//
// Its own thrown messages name ids only, never an address or a name: the
// outbox keeps them for staff.
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only", no Next imports (next-intl's createTranslator is plain).

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import guardianMessages from "../../../../messages/en-IN/guardian.json";
import { formats, LOCALE } from "../../../i18n/formats";
import { invitationPath } from "../../../lib/app-routes";
import { guardianInvitation, participantProfile } from "../../db/schema";
import { invitationStatus } from "../institutions/domain/invitation";
import {
  readTeenContact,
  REQUESTED_GUARDIAN_NAME,
  TEEN_INVITATION_TOKEN,
} from "./teen-contact";
import type { TeenInvitationMessageDeps } from "./teen-invitation-message";

const t = createTranslator({
  locale: "en-IN",
  messages: guardianMessages,
  namespace: "guardian.requestMessage",
});

/**
 * Sends one request's message. A request withdrawn, accepted or expired
 * before the outbox got to it gets nothing, and the delivery still counts
 * as done. Sending again (a retried delivery) sends the same link.
 */
export async function sendGuardianRequest(
  deps: TeenInvitationMessageDeps,
  payload: { requestId: string }
): Promise<void> {
  const [row] = await deps.db
    .select({
      channel: guardianInvitation.channel,
      contactCiphertext: guardianInvitation.contactCiphertext,
      tokenCiphertext: guardianInvitation.tokenCiphertext,
      inviteeNameCiphertext: guardianInvitation.inviteeNameCiphertext,
      status: guardianInvitation.status,
      expiresAt: guardianInvitation.expiresAt,
      teenName: participantProfile.fullName,
    })
    .from(guardianInvitation)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianInvitation.participantProfileId)
    )
    .where(eq(guardianInvitation.id, payload.requestId));
  if (
    !row?.tokenCiphertext ||
    !row.inviteeNameCiphertext ||
    invitationStatus(row, deps.clock.now()) !== "pending"
  ) {
    return;
  }
  if (!deps.auth.baseUrl) {
    // Thrown, so the outbox retries once the worker has APP_URL.
    throw new Error(
      `Guardian request ${payload.requestId} needs the site's base URL ` +
        "(APP_URL) for its link"
    );
  }
  const contact = readTeenContact(deps, row);
  if (contact.channel !== "email") {
    // Phone requests wait for their SMS template (HR-14).
    throw new Error(
      `Guardian request ${payload.requestId} has no way to send by ${contact.channel}`
    );
  }
  const token = deps.cipher.decrypt(TEEN_INVITATION_TOKEN, row.tokenCiphertext);
  const values = {
    guardian: deps.cipher.decrypt(
      REQUESTED_GUARDIAN_NAME,
      row.inviteeNameCiphertext
    ),
    teen: row.teenName,
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
