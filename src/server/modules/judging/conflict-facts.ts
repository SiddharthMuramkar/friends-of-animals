// Live ties are never materialised: a new role or guardian relationship
// takes effect at assignment and on the next blind scoring read (#96).
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import {
  entry,
  guardian,
  guardianLink,
  institutionRegistration,
  judgeConflict,
  participantProfile,
  registration,
  roundEntry,
  userRole,
} from "../../db/schema";
import {
  isConflicted,
  type EntryConflictFacts,
  type JudgeConflictFacts,
} from "./domain/conflicts";
export async function loadJudgeConflictFacts(
  db: AppDb,
  input: { roundId: string; judgeUserId: string }
): Promise<JudgeConflictFacts> {
  const rows = await db
    .select({
      source: judgeConflict.source,
      institutionId: judgeConflict.institutionId,
      entryId: judgeConflict.entryId,
    })
    .from(judgeConflict)
    .where(
      and(
        eq(judgeConflict.roundId, input.roundId),
        eq(judgeConflict.judgeUserId, input.judgeUserId)
      )
    );
  const roles = await db
    .select({ id: userRole.scopeId })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, input.judgeUserId),
        eq(userRole.scopeType, "institution"),
        inArray(userRole.role, ["institution_admin", "institution_coordinator"])
      )
    );
  const guarded = await db
    .select({ id: guardianLink.participantProfileId })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardian.userId, input.judgeUserId),
        isNull(guardianLink.revokedAt)
      )
    );
  const own = await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(
      or(
        eq(participantProfile.ownerUserId, input.judgeUserId),
        eq(participantProfile.loginUserId, input.judgeUserId)
      )
    );
  return {
    declaredInstitutionIds: rows.flatMap((r) =>
      r.source === "declared" && r.institutionId ? [r.institutionId] : []
    ),
    flaggedEntryIds: rows.flatMap((r) =>
      r.source === "staff" && r.entryId ? [r.entryId] : []
    ),
    roleInstitutionIds: roles.flatMap((r) => (r.id ? [r.id] : [])),
    guardedProfileIds: guarded.map((r) => r.id),
    ownProfileIds: own.map((r) => r.id),
  };
}
export async function loadEntryConflictFacts(
  db: AppDb,
  entryIds: string[]
): Promise<EntryConflictFacts[]> {
  if (entryIds.length === 0) return [];
  return db
    .select({
      entryId: entry.id,
      participantProfileId: entry.participantProfileId,
      institutionId: institutionRegistration.institutionId,
    })
    .from(entry)
    .innerJoin(registration, eq(registration.id, entry.registrationId))
    .leftJoin(
      institutionRegistration,
      eq(institutionRegistration.id, registration.institutionRegistrationId)
    )
    .where(inArray(entry.id, entryIds));
}
export async function conflictedEntryIds(
  db: AppDb,
  roundId: string,
  judgeUserId: string
): Promise<Set<string>> {
  const entries = await db
    .select({ id: roundEntry.entryId })
    .from(roundEntry)
    .where(eq(roundEntry.roundId, roundId));
  const facts = await loadJudgeConflictFacts(db, { roundId, judgeUserId });
  const entryFacts = await loadEntryConflictFacts(
    db,
    entries.map((e) => e.id)
  );
  return new Set(
    entryFacts.filter((e) => isConflicted(facts, e)).map((e) => e.entryId)
  );
}
