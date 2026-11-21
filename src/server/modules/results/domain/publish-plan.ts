// What the publish job does when it runs for a release (#99). The job is an
// outbox row due at the approved publish time; the relay can still hand it
// over more than once, or after an approver cancelled the release, so the
// plan is safe to run again and refuses anything that is not approved.
//
// Plain TypeScript, loads under plain Node.

import type { ResultsReleaseStatus } from "./release-status";

export type PublishPlan =
  /** Not approved (already published, rejected or cancelled): do nothing. */
  | { kind: "skip"; reason: "not_approved" }
  /** Ran before the publish time: run again at `dueAt`. */
  | { kind: "early"; dueAt: Date }
  /** The stored content no longer matches the approved hash: reject it. */
  | { kind: "reject"; reason: "stale_snapshot" }
  /** Publish now, stamped `at`. */
  | { kind: "publish"; at: Date };

export type PublishableRelease = {
  status: ResultsReleaseStatus;
  publishAt: Date;
  /** The hash stored when the release was last prepared or edited. */
  storedHash: string;
  /** The hash recomputed from the release as it is stored now. */
  contentHash: string;
};

/** The publish job's decision for `release` at `now`. */
export function planPublish(
  release: PublishableRelease,
  now: Date
): PublishPlan {
  if (release.status !== "approved") {
    return { kind: "skip", reason: "not_approved" };
  }
  if (release.storedHash !== release.contentHash) {
    return { kind: "reject", reason: "stale_snapshot" };
  }
  if (now.getTime() < release.publishAt.getTime()) {
    return { kind: "early", dueAt: release.publishAt };
  }
  return { kind: "publish", at: now };
}

/**
 * Whether an approval at `now` publishes straight away: the publish time came
 * while the release waited for approval. Publishing in the approval itself
 * keeps results from waiting on the worker.
 */
export function publishesOnApproval(publishAt: Date, now: Date): boolean {
  return publishAt.getTime() <= now.getTime();
}
