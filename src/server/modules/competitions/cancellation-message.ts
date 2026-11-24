// The messages a competition's cancellation sends (#80), read when each
// goes:
//
// - registration.competition_cancelled: each registration's family
//   contact (a minor's guardian, or the adult student) by email, through
//   the registration module's family-contact sender, as the confirmation
//   goes (#77); and an adult who registered themselves, on their own
//   account (`registration_owner`, by route row). It names the student,
//   the competition, the institution, the super admin's reason and one
//   sentence on how the fee comes back.
// - institution_registration.competition_cancelled: the institution's
//   coordinators and authorised person (`institution_coordinators`, by
//   route row), naming the registration's reference.
//
// The sentences come from messages/en-IN/competitionCancel.json, like
// every other copy (FOA reviews them, HR-34); a missing key fails the
// delivery loudly rather than mailing the key path.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq, inArray } from "drizzle-orm";
import { createTranslator } from "next-intl";

import competitionCancel from "../../../../messages/en-IN/competitionCancel.json";
import { LOCALE } from "../../../i18n/formats";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  competitionCancellationEmail,
  institution,
  institutionRegistration,
  participantProfile,
  registration,
  userRole,
} from "../../db/schema";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { EmailNotSentError } from "../../ports/email";
import { familyContactEmail } from "../registration/confirmation-message";
import type { FeeReturn } from "./domain/cancellation";

function refuseFallback(error: Error): never {
  throw error;
}

const feeWords = createTranslator({
  locale: LOCALE,
  messages: competitionCancel,
  namespace: "competitionCancel.message.fee",
  onError: refuseFallback,
});

/** What a family's cancellation may say, beyond the recipient's name. */
export const CANCELLATION_VARIABLES = [
  "participant.name",
  "competition.name",
  "institution.name",
  "cancellation.reason",
  "cancellation.fee",
] as const;

/** What a coordinators' cancellation may say, beyond the recipient's. */
export const INSTITUTION_CANCELLATION_VARIABLES = [
  "competition.name",
  "institution.name",
  "registration.reference",
  "cancellation.reason",
] as const;

/** The registration's cancellation, as its message says it. */
export async function cancellationValues(
  db: AppDb,
  { registrationId, refund }: { registrationId: string; refund: FeeReturn }
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      participantName: participantProfile.fullName,
      competitionName: competition.name,
      reason: competition.cancelReason,
      institutionName: institution.name,
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
  if (!row) return {};
  return {
    "participant.name": row.participantName,
    "competition.name": row.competitionName,
    "institution.name": row.institutionName ?? "",
    "cancellation.reason": row.reason ?? "",
    "cancellation.fee": feeWords(refund),
  };
}

/** The institution registration's cancellation, as its message says it. */
export async function institutionCancellationValues(
  db: AppDb,
  institutionRegistrationId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      competitionName: competition.name,
      reason: competition.cancelReason,
      institutionName: institution.name,
      reference: institutionRegistration.reference,
    })
    .from(institutionRegistration)
    .innerJoin(
      competition,
      eq(competition.id, institutionRegistration.competitionId)
    )
    .innerJoin(
      institution,
      eq(institution.id, institutionRegistration.institutionId)
    )
    .where(eq(institutionRegistration.id, institutionRegistrationId));
  if (!row) return {};
  return {
    "competition.name": row.competitionName,
    "institution.name": row.institutionName,
    "registration.reference": row.reference,
    "cancellation.reason": row.reason ?? "",
  };
}

/**
 * Everyone who acts for the institution registration's institution: its
 * coordinators and its authorised person.
 */
export async function institutionCoordinators(
  db: AppDb,
  institutionRegistrationId: string
): Promise<string[]> {
  const [registered] = await db
    .select({ institutionId: institutionRegistration.institutionId })
    .from(institutionRegistration)
    .where(eq(institutionRegistration.id, institutionRegistrationId));
  if (!registered) return [];
  const rows = await db
    .selectDistinct({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(
        inArray(userRole.role, [
          "institution_coordinator",
          "institution_admin",
        ]),
        eq(userRole.scopeType, "institution"),
        eq(userRole.scopeId, registered.institutionId)
      )
    )
    .orderBy(asc(userRole.userId));
  return rows.map((row) => row.userId);
}

/**
 * The outbox handler registration.send_cancellation: the family contact's
 * email, whatever the registration's status now (cancelled, waiting for
 * its refund, or refunded already).
 */
export async function sendCancellationToFamily(
  deps: OutboxDeps,
  delivery: Delivery<"registration.competition_cancelled">
): Promise<void> {
  if (delivery.payload.awaitingGuardian) return;
  const { db, email, clock } = deps;
  const deliveryKey = eq(competitionCancellationEmail.deliveryId, delivery.id);
  const [previous] = await db
    .select({ sentAt: competitionCancellationEmail.sentAt })
    .from(competitionCancellationEmail)
    .where(deliveryKey);
  const uncertain = new Error(
    `Family cancellation email for delivery ${delivery.id} needs reconciliation`
  );
  if (previous) {
    if (previous.sentAt) return;
    throw uncertain;
  }

  const message = await familyContactEmail(deps, {
    eventType: delivery.eventType,
    registrationId: delivery.payload.registrationId,
    sendWhile: () => true,
    values: () => cancellationValues(deps.db, delivery.payload),
  });
  if (!message) return;

  const [reserved] = await db
    .insert(competitionCancellationEmail)
    .values({ deliveryId: delivery.id })
    .onConflictDoNothing()
    .returning({ deliveryId: competitionCancellationEmail.deliveryId });
  if (!reserved) throw uncertain;

  try {
    await email.send(message, { deliveryId: delivery.id });
  } catch (error) {
    if (!(error instanceof EmailNotSentError)) throw uncertain;
    // A verified rejection is safe to send again on the relay's retry.
    await db.delete(competitionCancellationEmail).where(deliveryKey);
    throw error;
  }
  await db
    .update(competitionCancellationEmail)
    .set({ sentAt: clock.now() })
    .where(deliveryKey);
}
