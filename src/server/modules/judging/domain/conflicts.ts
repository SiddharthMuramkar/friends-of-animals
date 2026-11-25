// When a judge has a conflict of interest with an entry (#95). Two kinds
// of tie are stored as rows: institutions the judge declared, and entries
// staff flagged after reading the judge's statement. Three are read live,
// never stored, so a tie made after onboarding still counts: a role at the
// entry's institution (coordinator or admin), being the participant's
// guardian, and being the participant.
//
// Assignment refuses a conflicted pair, and the blind scoring views check
// again before showing an entry. The judge is never told why an entry is
// missing; the sources are for staff.
//
// Pure: no database. Loads under plain Node (seed script).

/** Everything known about one judge's ties, loaded once per round. */
export type JudgeConflictFacts = {
  /** Institutions the judge declared during onboarding. */
  declaredInstitutionIds: readonly string[];
  /** Entries staff flagged as conflicts for this judge in this round. */
  flaggedEntryIds: readonly string[];
  /** Institutions where the judge holds a coordinator or admin role. */
  roleInstitutionIds: readonly string[];
  /** Participant profiles the judge is an active guardian of. */
  guardedProfileIds: readonly string[];
  /** Participant profiles that are the judge's own. */
  ownProfileIds: readonly string[];
};

/** What an entry's conflicts depend on. */
export type EntryConflictFacts = {
  entryId: string;
  /** The institution it was entered through; null for an individual entry. */
  institutionId: string | null;
  participantProfileId: string;
};

export const CONFLICT_SOURCES = [
  "declared_institution",
  "staff_flag",
  "institution_role",
  "guardian",
  "own_entry",
] as const;

export type ConflictSource = (typeof CONFLICT_SOURCES)[number];

/** Every reason the judge conflicts with the entry, in a fixed order. */
export function conflictSources(
  judge: JudgeConflictFacts,
  entry: EntryConflictFacts
): ConflictSource[] {
  const institution = entry.institutionId;
  const applies: Record<ConflictSource, boolean> = {
    declared_institution:
      institution !== null &&
      judge.declaredInstitutionIds.includes(institution),
    staff_flag: judge.flaggedEntryIds.includes(entry.entryId),
    institution_role:
      institution !== null && judge.roleInstitutionIds.includes(institution),
    guardian: judge.guardedProfileIds.includes(entry.participantProfileId),
    own_entry: judge.ownProfileIds.includes(entry.participantProfileId),
  };
  return CONFLICT_SOURCES.filter((source) => applies[source]);
}

export function isConflicted(
  judge: JudgeConflictFacts,
  entry: EntryConflictFacts
): boolean {
  return conflictSources(judge, entry).length > 0;
}
