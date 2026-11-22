// The lifecycle of a blog post or story. Every status change goes through
// `nextPostStatus`, so the moves below are the only ones a post can make:
//
//   (new) ─create─▶ draft ─schedule─▶ scheduled ─scheduled_publish─▶ published
//                    │ ▲                 │  ▲ reschedule                  │
//                    │ └──unschedule─────┘──┘                            │
//                    └────────────publish─────────▶ published ─archive─▶ archived
//   archived ─restore─▶ draft
//
// `publish` also works on a scheduled post ("publish now"); its pending job
// then finds the post no longer scheduled and does nothing. A published
// post leaves the public site only by being archived.
//
// Pure: no I/O, no "server-only", so the worker and tests can load it.

/** Build the `post_status` pg enum from this list so the two can't drift. */
export const POST_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "archived",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_TRIGGERS = [
  "create",
  "schedule",
  "reschedule",
  "unschedule",
  "publish",
  "scheduled_publish",
  "archive",
  "restore",
] as const;

export type PostTrigger = (typeof POST_TRIGGERS)[number];

type From = PostStatus | "new";

const MOVES: Readonly<Record<PostTrigger, Partial<Record<From, PostStatus>>>> =
  {
    create: { new: "draft" },
    schedule: { draft: "scheduled" },
    reschedule: { scheduled: "scheduled" },
    unschedule: { scheduled: "draft" },
    publish: { draft: "published", scheduled: "published" },
    scheduled_publish: { scheduled: "published" },
    archive: { published: "archived" },
    restore: { archived: "draft" },
  };

/**
 * The status `trigger` moves a post to from `from` (null for a post not yet
 * created), or null when the lifecycle forbids the move.
 */
export function nextPostStatus(
  from: PostStatus | null,
  trigger: PostTrigger
): PostStatus | null {
  return MOVES[trigger][from ?? "new"] ?? null;
}

/** Archived posts are read-only until restored to a draft. */
export function canEditPost(status: PostStatus): boolean {
  return status !== "archived";
}

/**
 * Whether the public site may show a post at `now`: a published post from
 * its publish instant, and a scheduled post from the instant it is
 * scheduled for, even if the publish job hasn't run yet (a busy or stopped
 * worker never holds a post back). Drafts and archived posts are never
 * public. The public queries filter with the same rule.
 */
export function isPostPublic(
  post: {
    status: PostStatus;
    publishedAt?: Date | null;
    publishAt?: Date | null;
  },
  now: Date
): boolean {
  const from =
    post.status === "published"
      ? post.publishedAt
      : post.status === "scheduled"
        ? post.publishAt
        : null;
  return from !== null && from !== undefined && from.getTime() <= now.getTime();
}
