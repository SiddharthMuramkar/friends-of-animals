// The registration confirmation (#77), sent by the outbox handler
// registration.send_confirmation after registration.confirmed: an email to
// the student's family contact naming the student, the competition, the
// institution and the registration number. The contact is a minor's
// guardian, or an adult student themself, kept encrypted on the participant
// profile (#75), not a user, so #69's dispatcher can't reach them: their
// route row (audience `family_contact`) resolves to nobody. This handler
// reads that row instead and, while it is enabled with email, renders its
// template (staff edit the wording) and sends it to the decrypted address.
// The event carries only the registration's id.
//
// Email only, and only to a contact with an email: SMS waits for registered
// DLT templates (HR-14). A retried delivery sends the same message again.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  institution,
  institutionRegistration,
  messageRoute,
  messageTemplate,
  participantProfile,
  registration,
} from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { oneLineSubject, type EmailMessage } from "../../ports/email";
import {
  renderEmailHtml,
  renderTemplate,
} from "../notifications/domain/template";
import { DEFAULT_LOCALE } from "../notifications/locale";
import type { RegistrationStatus } from "./domain/registration-status";
import { PROFILE_PURPOSE } from "./student-profile";

/** The audience of the route row that tells the family. */
export const FAMILY_AUDIENCE = "family_contact";

/** The variables a confirmation template may use, beyond the recipient's. */
export const CONFIRMATION_VARIABLES = [
  "participant.name",
  "competition.name",
  "institution.name",
  "registration.number",
] as const;

/** What the confirmation says about the registration, read as it goes. */
export async function confirmationValues(
  db: AppDb,
  registrationId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      participantName: participantProfile.fullName,
      competitionName: competition.name,
      institutionName: institution.name,
      registrationNumber: registration.registrationNumber,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .innerJoin(competition, eq(competition.id, registration.competitionId))
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, registration.institutionRegistrationId)
    )
    .leftJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .where(eq(registration.id, registrationId));
  if (!row?.registrationNumber) return {};
  return {
    "participant.name": row.participantName,
    "competition.name": row.competitionName,
    "institution.name": row.institutionName ?? "",
    "registration.number": row.registrationNumber,
  };
}

export async function sendRegistrationConfirmation(
  deps: OutboxDeps,
  delivery: Delivery<"registration.confirmed">
): Promise<void> {
  const { registrationId } = delivery.payload;
  const message = await familyContactEmail(deps, {
    eventType: delivery.eventType,
    registrationId,
    // Gone, or no longer confirmed (a refund, #80): nothing to send.
    sendWhile: (status) => status === "confirmed",
    values: () => confirmationValues(deps.db, registrationId),
  });
  if (message) await deps.email.send(message);
}

/**
 * Renders an email to a registration's family contact (a minor's guardian, or the adult
 * student) with the template of the event's enabled `family_contact`
 * route, while that route sends email and the registration is in a status
 * `sendWhile` accepts. `values` gives the template's variables beyond the
 * recipient's name. Also the cancellation's (#80).
 */
export async function familyContactEmail(
  deps: OutboxDeps,
  {
    eventType,
    registrationId,
    sendWhile,
    values,
  }: {
    eventType: string;
    registrationId: string;
    sendWhile: (status: RegistrationStatus) => boolean;
    values: () => Promise<Record<string, string>>;
  }
): Promise<EmailMessage | null> {
  const [contact] = await deps.db
    .select({
      status: registration.status,
      fullName: participantProfile.fullName,
      emailCiphertext: participantProfile.emailCiphertext,
      guardianNameCiphertext: participantProfile.guardianNameCiphertext,
      guardianEmailCiphertext: participantProfile.guardianEmailCiphertext,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(eq(registration.id, registrationId));
  if (!contact || !sendWhile(contact.status)) return null;

  // Switched off, or not by email: the family isn't told.
  const [route] = await deps.db
    .select({
      templateKey: messageRoute.templateKey,
      channels: messageRoute.channels,
    })
    .from(messageRoute)
    .where(
      and(
        eq(messageRoute.eventType, eventType),
        eq(messageRoute.audience, FAMILY_AUDIENCE),
        eq(messageRoute.enabled, true)
      )
    )
    .orderBy(asc(messageRoute.createdAt))
    .limit(1);
  if (!route?.channels.includes("email")) return null;

  // A minor's guardian, or else the adult student.
  const guardian = contact.guardianNameCiphertext !== null;
  const to = guardian
    ? contact.guardianEmailCiphertext &&
      deps.cipher.decrypt(
        PROFILE_PURPOSE.guardianEmail,
        contact.guardianEmailCiphertext
      )
    : contact.emailCiphertext &&
      deps.cipher.decrypt(PROFILE_PURPOSE.email, contact.emailCiphertext);
  if (!to) return null;

  const [template] = await deps.db
    .select({ subject: messageTemplate.subject, body: messageTemplate.body })
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.key, route.templateKey),
        eq(messageTemplate.channel, "email"),
        eq(messageTemplate.locale, DEFAULT_LOCALE)
      )
    );
  if (!template) {
    throw new Error(`Template ${route.templateKey} has no email`);
  }
  const rendered = {
    "recipient.name": guardian
      ? deps.cipher.decrypt(
          PROFILE_PURPOSE.guardianName,
          contact.guardianNameCiphertext!
        )
      : contact.fullName,
    ...(await values()),
  };
  const text = renderTemplate(template.body, rendered);
  return {
    to,
    subject: oneLineSubject(renderTemplate(template.subject ?? "", rendered)),
    text,
    html: renderEmailHtml(text),
  };
}
