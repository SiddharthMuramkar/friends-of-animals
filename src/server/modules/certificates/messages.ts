import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { familyContactEmail } from "../registration/confirmation-message";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import type { FieldCipher } from "../../crypto/field-cipher";
import {
  certificate,
  competition,
  participantProfile,
  registration,
} from "../../db/schema";
import type { EventOf } from "../../outbox/events";
import { guardianLinksByProfile } from "../guardians/participant-audience";
import { isAdultAt } from "../participants/domain/age";
import { parseIsoDate } from "../registration/domain/calendar-date";
import { PROFILE_PURPOSE } from "../registration/student-profile";
type ReadyPayload = EventOf<"certificates.ready">["payload"];
export const CERTIFICATE_READY_VARIABLES = ["competition.name"] as const;
export async function certificateReadyValues(
  db: AppDb,
  p: ReadyPayload
): Promise<Record<string, string>> {
  const [comp] = await db
    .select({ name: competition.name })
    .from(competition)
    .where(eq(competition.id, p.competitionId));
  return comp ? { "competition.name": comp.name } : {};
}
/** Readiness groups every active certificate in the release by its current
 * eligible recipient. One guardian with two children receives one notice. */
export async function readyCertificateRecipients(
  db: AppDb,
  releaseId: string,
  cipher: FieldCipher
) {
  const rows = await db
    .select({
      profileId: participantProfile.id,
      dob: participantProfile.dobCiphertext,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      registeredAt: registration.createdAt,
      renderStatus: certificate.renderStatus,
    })
    .from(certificate)
    .innerJoin(registration, eq(certificate.registrationId, registration.id))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, certificate.participantProfileId)
    )
    .where(
      and(
        eq(certificate.sourceReleaseId, releaseId),
        eq(certificate.status, "issued"),
        eq(registration.status, "confirmed")
      )
    );
  const links = await guardianLinksByProfile(
    db,
    rows.map((r) => r.profileId)
  );
  const readiness = new Map<string, boolean>();
  for (const row of rows) {
    if (!row.dob) continue;
    const dob = parseIsoDate(cipher.decrypt(PROFILE_PURPOSE.dob, row.dob));
    if (!dob) continue;
    const recipients =
      isAdultAt(dob, row.registeredAt) &&
      row.ownerKind === "self" &&
      row.ownerUserId
        ? [row.ownerUserId]
        : (links.get(row.profileId) ?? [])
            .filter((l) => l.verified && !l.revoked)
            .map((l) => l.userId);
    for (const id of recipients)
      readiness.set(
        id,
        (readiness.get(id) ?? true) && row.renderStatus === "rendered"
      );
  }
  return [...readiness].flatMap(([id, ready]) => (ready ? [id] : []));
}
export async function certificateReadyRecipients(
  db: AppDb,
  p: ReadyPayload,
  cipher: FieldCipher
) {
  return (await readyCertificateRecipients(db, p.releaseId, cipher)).includes(
    p.recipientUserId
  )
    ? [p.recipientUserId]
    : [];
}

// Reissued notices resolve the current owner or family contact rather than
// carrying any personal details or email addresses in the outbox.
async function replacementFacts(db: AppDb, id: string) {
  const [row] = await db
    .select({
      registrationId: registration.id,
      route: registration.route,
      profileId: participantProfile.id,
      dob: participantProfile.dobCiphertext,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      guardianName: participantProfile.guardianNameCiphertext,
      guardianEmail: participantProfile.guardianEmailCiphertext,
      registeredAt: registration.createdAt,
    })
    .from(certificate)
    .innerJoin(registration, eq(registration.id, certificate.registrationId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, certificate.participantProfileId)
    )
    .where(
      and(
        eq(certificate.id, id),
        eq(certificate.status, "issued"),
        eq(registration.status, "confirmed")
      )
    );
  return row;
}
export async function reissueRecipients(
  db: AppDb,
  id: string,
  cipher: FieldCipher
) {
  const row = await replacementFacts(db, id);
  if (!row || !row.dob) return [];
  const dob = parseIsoDate(cipher.decrypt(PROFILE_PURPOSE.dob, row.dob));
  if (!dob) return [];
  if (
    isAdultAt(dob, row.registeredAt) &&
    row.ownerKind === "self" &&
    row.ownerUserId
  )
    return [row.ownerUserId];
  const links =
    (await guardianLinksByProfile(db, [row.profileId])).get(row.profileId) ??
    [];
  return [
    ...new Set(
      links.filter((l) => l.verified && !l.revoked).map((l) => l.userId)
    ),
  ];
}
export async function sendFamilyReissue(
  deps: OutboxDeps,
  delivery: Delivery<"certificate.reissued">
) {
  const row = await replacementFacts(deps.db, delivery.payload.certificateId);
  if (!row || row.route !== "institution" || !row.dob) return;
  if (
    (
      await reissueRecipients(
        deps.db,
        delivery.payload.certificateId,
        deps.cipher
      )
    ).length
  )
    return;
  const dob = parseIsoDate(deps.cipher.decrypt(PROFILE_PURPOSE.dob, row.dob));
  if (
    !dob ||
    (!isAdultAt(dob, row.registeredAt) &&
      (!row.guardianName || !row.guardianEmail))
  )
    return;
  const message = await familyContactEmail(deps, {
    eventType: delivery.eventType,
    registrationId: row.registrationId,
    sendWhile: (status) => status === "confirmed",
    values: async () => ({}),
  });
  if (message) await deps.email.send(message, { deliveryId: delivery.id });
}
