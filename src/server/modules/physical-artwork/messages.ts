import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { competition, entry, physicalArtwork } from "../../db/schema";
import { institutionCoordinators } from "../competitions/cancellation-message";
import { guardianOfParticipant } from "../guardians/participant-audience";
import { ownerOfRegistration } from "../participants/owner";
import type { AudienceMember } from "../notifications/domain/audience-member";
import { createFormatter } from "next-intl";
import { formats, LOCALE, TIME_ZONE } from "../../../i18n/formats";
const formatter = createFormatter({
  locale: LOCALE,
  formats,
  timeZone: TIME_ZONE,
});

export const ARTWORK_VARIABLES = [
  "artwork.code",
  "entry.code",
  "artwork.packaging",
  "artwork.shipping",
  "artwork.address",
  "artwork.deadline",
  "competition.name",
] as const;

export async function artworkValues(
  db: AppDb,
  id: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      artwork: physicalArtwork,
      entryCode: entry.code,
      competitionName: competition.name,
    })
    .from(physicalArtwork)
    .innerJoin(entry, eq(entry.id, physicalArtwork.entryId))
    .innerJoin(competition, eq(competition.id, physicalArtwork.competitionId))
    .where(eq(physicalArtwork.id, id));
  if (!row) return {};
  const work = row.artwork;
  return {
    "artwork.code": work.artworkCode,
    "entry.code": row.entryCode,
    "artwork.packaging": work.packagingInstructions,
    "artwork.shipping": work.shippingPayer === "foa" ? "FOA" : "the sender",
    "artwork.address": work.facilityAddress,
    "artwork.deadline": formatter.dateTime(
      work.dispatchDeadline,
      "longDateTime"
    ),
    "competition.name": row.competitionName,
  };
}

export async function artworkRecipients(
  db: AppDb,
  id: string,
  receipt: boolean
): Promise<AudienceMember[]> {
  const [row] = await db
    .select()
    .from(physicalArtwork)
    .where(eq(physicalArtwork.id, id));
  if (!row) return [];
  if (row.institutionRegistrationId) {
    const recipients = await institutionCoordinators(
      db,
      row.institutionRegistrationId
    );
    return receipt && row.dispatchedBy && recipients.includes(row.dispatchedBy)
      ? [row.dispatchedBy]
      : recipients;
  }
  const recipients = [
    ...(await ownerOfRegistration(db, row.registrationId)),
    ...(await guardianOfParticipant(db, row.registrationId)),
  ];
  // A teen may dispatch but only verified guardians hear via external channels.
  const adults = recipients.filter((member) => typeof member === "string");
  return receipt && row.dispatchedBy && adults.includes(row.dispatchedBy)
    ? [row.dispatchedBy]
    : adults;
}
