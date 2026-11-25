// The results release status machine (#99): which statuses a release of a
// competition's results passes through, and who may move it. A competition
// manager prepares and submits; a second staff member approves or rejects;
// only the system publishes, at the approved instant. Every value is defined
// here up front, so no later migration has to add one to the enum.
//
// Plain TypeScript with no imports, so the schema file and the seed script
// can load it under plain Node.

/** Every status, in the order a release passes through them. */
export const RESULTS_RELEASE_STATUSES = [
  "pending_approval",
  "approved",
  "published",
  "rejected",
] as const;

export type ResultsReleaseStatus = (typeof RESULTS_RELEASE_STATUSES)[number];

/** A release is created by preparing it, already submitted for approval. */
export const INITIAL_RELEASE_STATUS: ResultsReleaseStatus = "pending_approval";

/**
 * Who makes a move: the person who prepared the release, a second staff
 * member who may approve it, or the system (the publish job, or a check that
 * finds the stored content changed).
 */
export const RELEASE_CAUSES = ["preparer", "approver", "system"] as const;

export type ReleaseCause = (typeof RELEASE_CAUSES)[number];

/**
 * The allowed moves, each with the causes that may make it. A pair that is
 * missing is forbidden for everyone. `rejected` and `published` have no way
 * out: a fix after a rejection is a new release with the next version.
 */
const TRANSITIONS: {
  readonly [From in ResultsReleaseStatus]: Partial<
    Record<ResultsReleaseStatus, readonly ReleaseCause[]>
  >;
} = {
  pending_approval: {
    approved: ["approver"],
    rejected: ["approver", "system"],
  },
  approved: { published: ["system"], rejected: ["approver", "system"] },
  published: {},
  rejected: {},
};

/** Who may move a release from `from` to `to`; empty if nobody may. */
export function releaseTransitionCauses(
  from: ResultsReleaseStatus,
  to: ResultsReleaseStatus
): readonly ReleaseCause[] {
  return TRANSITIONS[from][to] ?? [];
}

/** Whether `by` may move a release from `from` to `to`. */
export function canTransitionRelease(
  from: ResultsReleaseStatus,
  to: ResultsReleaseStatus,
  by: ReleaseCause
): boolean {
  return releaseTransitionCauses(from, to).includes(by);
}

/** Whether nothing can move a release on from `status`. */
export function isTerminalRelease(status: ResultsReleaseStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

/**
 * The statuses of a release still in progress. A competition has at most one
 * such release at a time (a partial unique index in the schema backs this).
 */
export const LIVE_RELEASE_STATUSES = [
  "pending_approval",
  "approved",
] as const satisfies readonly ResultsReleaseStatus[];

/** Whether `status` is one of the live statuses. */
export function isLiveRelease(status: ResultsReleaseStatus): boolean {
  return (LIVE_RELEASE_STATUSES as readonly ResultsReleaseStatus[]).includes(
    status
  );
}
