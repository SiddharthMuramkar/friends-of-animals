// What an entry's messages may say (#85): entry.submitted (entry_received),
// entry.file_rejected and entry.file_failed. Their route rows send them to
// the registration's adult (`registration_owner`) or the child's guardians
// (`guardian_of_participant`). Only an adult's own notice may use the
// participant's name and the title saved with the submitted upload. On the
// school route (#87) the student's family contact hears of the receipt
// (./family-receipt.ts), which names the student and their institution, as
// the registration confirmation does.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, sql } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import {
  competition,
  entry,
  entryFile,
  institution,
  participantProfile,
} from "../../db/schema";

/** The variables an entry's templates may use, beyond the recipient's. */
export const ENTRY_ATTEMPT_VARIABLES = [
  "competition.name",
  "entry.code",
  "entry.uploadReference",
] as const;

export const ENTRY_RECEIPT_VARIABLES = [
  ...ENTRY_ATTEMPT_VARIABLES,
  "participant.name",
  "entry.title",
  "institution.name",
] as const;

/** Resolves the attempt named by the event even if a newer file is live. */
export async function entryValues(
  db: AppDb,
  {
    entryId,
    entryFileId,
    registrationId,
  }: { entryId: string; entryFileId: string; registrationId: string },
  receipt = false
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      competitionName: competition.name,
      code: entry.code,
      uploadReference: entryFile.id,
      ...(receipt
        ? {
            participantName: sql<
              string | null
            >`case when ${participantProfile.ownerKind} in ('self', 'institution') then ${participantProfile.fullName} end`,
            institutionName: institution.name,
            title: sql<
              string | null
            >`case when ${participantProfile.ownerKind} = 'self' then ${entryFile.receiptTitle} end`,
          }
        : {}),
    })
    .from(entry)
    .innerJoin(
      entryFile,
      and(eq(entryFile.entryId, entry.id), eq(entryFile.id, entryFileId))
    )
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, entry.participantProfileId)
    )
    .leftJoin(
      institution,
      eq(institution.id, participantProfile.managingInstitutionId)
    )
    .where(
      and(eq(entry.id, entryId), eq(entry.registrationId, registrationId))
    );
  if (!row) return {};
  return {
    "competition.name": row.competitionName,
    "entry.code": row.code,
    "entry.uploadReference": row.uploadReference,
    ...(receipt
      ? {
          "participant.name": row.participantName ?? "",
          "entry.title": row.title ?? "",
          "institution.name": row.institutionName ?? "",
        }
      : {}),
  };
}
