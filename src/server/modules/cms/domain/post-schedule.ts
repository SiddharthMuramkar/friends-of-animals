// Scheduled publishing. Scheduling a post enqueues one delayed job that
// comes due at the post's publish instant and carries that instant. The job
// re-reads the post and acts only if the post is still scheduled for that
// same instant, so unscheduling, rescheduling or "publish now" never needs
// to find and cancel the old job: it just does nothing when it runs.
//
// Pure: no I/O, no "server-only", so the worker and tests can load it.

import type { PostStatus } from "./post-status";

export type PublishAtRefusal = "invalid_instant" | "not_in_future";

export type Check<Refusal> = { ok: true } | { ok: false; refusal: Refusal };

/** A post can be scheduled only for an instant strictly after `now`. */
export function checkPublishAt(
  publishAt: Date,
  now: Date
): Check<PublishAtRefusal> {
  if (Number.isNaN(publishAt.getTime())) {
    return { ok: false, refusal: "invalid_instant" };
  }
  if (publishAt.getTime() <= now.getTime()) {
    return { ok: false, refusal: "not_in_future" };
  }
  return { ok: true };
}

export type ScheduledPublishDecision =
  /** Publish now; the post is dated to the instant it was scheduled for. */
  | { action: "publish"; publishedAt: Date }
  /** Due early (the queue ran ahead of the post): try again at `until`. */
  | { action: "wait"; until: Date }
  /** This job is stale: the post moved on, and any newer job handles it. */
  | { action: "skip"; reason: "not_scheduled" | "rescheduled" };

/**
 * What the scheduled-publish job does with `post`, as read inside the job's
 * transaction, when the job enqueued for `job.publishAt` runs at `now`.
 */
export function decideScheduledPublish(
  post: { status: PostStatus; publishAt: Date | null },
  job: { publishAt: Date },
  now: Date
): ScheduledPublishDecision {
  if (post.status !== "scheduled") {
    return { action: "skip", reason: "not_scheduled" };
  }
  if (
    post.publishAt === null ||
    post.publishAt.getTime() !== job.publishAt.getTime()
  ) {
    return { action: "skip", reason: "rescheduled" };
  }
  if (now.getTime() < post.publishAt.getTime()) {
    return { action: "wait", until: post.publishAt };
  }
  return { action: "publish", publishedAt: post.publishAt };
}
