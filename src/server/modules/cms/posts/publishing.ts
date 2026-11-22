// Scheduling, publishing, archiving and restoring posts (#112).
//
//   schedulePost({ postId, publishAt }) → content manager (also reschedules)
//   unschedulePost({ postId })          → content manager
//   publishPost({ postId })             → content manager ("publish now")
//   archivePost({ postId })             → content manager
//   restorePost({ postId })             → content manager
//   publishScheduledPost({ postId, publishAt }) → the cms.post_scheduled
//                                          handler (worker)
//
// Every move goes through `nextPostStatus` and writes one audit entry,
// `cms_post.<verb>`, with the status and dates before and after (never the
// body). Scheduling saves one cms.post_scheduled event, delivered at the
// instant (`availableAt`); the job locks the post and asks
// `decideScheduledPublish` what to do, so a delivery made stale by an
// unschedule, a reschedule or "publish now" does nothing, and nothing ever
// needs cancelling. The job checks what going live needs again (./gates.ts)
// and takes a post that fails it back to a draft. Going live emits
// cms.post_published.
//
// Hand moves that change the public site return the cache tags their
// Server Action refreshes; the job can't, so 112b's cached reads live only
// until the next scheduled instant.
//
// Loads under plain Node (the worker): relative imports only.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Role } from "../../../access/domain/roles";
import type { Actor } from "../../../actor";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import { cmsPost, type CmsPost } from "../../../db/schema";
import { emit } from "../../../outbox/emit";
import type { Clock } from "../../../ports/clock";
import {
  checkPublishAt,
  decideScheduledPublish,
} from "../domain/post-schedule";
import {
  isPostPublic,
  nextPostStatus,
  type PostStatus,
  type PostTrigger,
} from "../domain/post-status";
import { postTags } from "./cache-tags";
import type { PostsContext } from "./drafts";
import { goingLiveRefusal, type ImageNotReady } from "./gates";
import type { PostInputRefusal } from "./input";
import { loadPost } from "./store";

type NotFound = { ok: false; error: "not_found" };
type InvalidTransition = { ok: false; error: "invalid_transition" };

export type SchedulePostResult =
  | { ok: true; publishAt: Date }
  | NotFound
  | InvalidTransition
  | { ok: false; error: "not_in_future" | "invalid_instant" }
  | PostInputRefusal
  | ImageNotReady;

export type PublishPostResult =
  | { ok: true; publishedAt: Date; tags: string[] }
  | NotFound
  | InvalidTransition
  | PostInputRefusal
  | ImageNotReady;

export type UnschedulePostResult = { ok: true } | NotFound | InvalidTransition;

export type ArchivePostResult =
  | { ok: true; tags: string[] }
  | NotFound
  | InvalidTransition;

export type RestorePostResult = { ok: true } | NotFound | InvalidTransition;

const scheduleInput = z.object({
  postId: z.string(),
  publishAt: z.coerce.date(),
});

/** The dates an audit entry records, as they are or will be. */
type Dates = Pick<CmsPost, "status" | "publishAt" | "publishedAt">;

function snapshot({ status, publishAt, publishedAt }: Dates) {
  return {
    status,
    publishAt: publishAt?.toISOString() ?? null,
    publishedAt: publishedAt?.toISOString() ?? null,
  };
}

/** One status move: the row's new columns, its audit entry, in `tx`. */
async function move(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  post: CmsPost,
  verb: "scheduled" | "unscheduled" | "published" | "archived" | "restored",
  next: Dates & { archivedAt: Date | null },
  actorRole: Role | null
): Promise<void> {
  const now = ctx.clock.now();
  await tx
    .update(cmsPost)
    .set({
      ...next,
      updatedAt: now,
      ...(ctx.actor.kind === "user" ? { updatedBy: ctx.actor.userId } : {}),
    })
    .where(eq(cmsPost.id, post.id));
  await recordAudit(tx, ctx, {
    action: `cms_post.${verb}`,
    entity: { type: "cms_post", id: post.id },
    before: snapshot(post),
    after: snapshot(next),
    actorRole,
  });
}

async function announcePublished(
  tx: AppDb,
  clock: Clock,
  postId: string
): Promise<void> {
  await emit(tx, clock, {
    type: "cms.post_published",
    aggregate: { type: "cms_post", id: postId },
    payload: { postId },
  });
}

/**
 * Runs `body` on the locked post if `trigger` may move it, with the status
 * it moves to; not_found or invalid_transition otherwise, writing nothing.
 */
async function withMove<R>(
  ctx: PostsContext,
  postId: string,
  trigger: PostTrigger,
  body: (tx: AppDb, post: CmsPost, to: PostStatus) => Promise<R>
): Promise<R | NotFound | InvalidTransition> {
  return ctx.db.transaction(async (tx) => {
    const post = await loadPost(tx, postId, { lock: true });
    if (!post) return { ok: false, error: "not_found" } as const;
    const to = nextPostStatus(post.status, trigger);
    if (to === null) return { ok: false, error: "invalid_transition" } as const;
    return body(tx, post, to);
  });
}

/**
 * Schedules a draft, or moves a scheduled post's instant, for a moment
 * strictly in the future. The post must be ready to go live.
 */
export async function schedulePost(
  ctx: PostsContext,
  input: { postId: string; publishAt: Date | string }
): Promise<SchedulePostResult> {
  const { role } = await authorize(ctx, "cms.post.publish");
  const parsed = scheduleInput.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.some((issue) => issue.path[0] === "publishAt")
      ? { ok: false, error: "invalid_instant" }
      : { ok: false, error: "not_found" };
  }
  const { postId, publishAt } = parsed.data;
  const check = checkPublishAt(publishAt, ctx.clock.now());
  if (!check.ok) return { ok: false, error: check.refusal };

  return ctx.db.transaction(async (tx): Promise<SchedulePostResult> => {
    const post = await loadPost(tx, postId, { lock: true });
    if (!post) return { ok: false, error: "not_found" };
    const trigger = post.status === "scheduled" ? "reschedule" : "schedule";
    if (nextPostStatus(post.status, trigger) === null) {
      return { ok: false, error: "invalid_transition" };
    }
    const refused = await goingLiveRefusal(tx, post.id, post);
    if (refused) return refused;
    await move(
      tx,
      ctx,
      post,
      "scheduled",
      {
        status: "scheduled",
        publishAt,
        publishedAt: post.publishedAt,
        archivedAt: null,
      },
      role
    );
    await emit(
      tx,
      ctx.clock,
      {
        type: "cms.post_scheduled",
        aggregate: { type: "cms_post", id: post.id },
        payload: { postId: post.id, publishAt: publishAt.toISOString() },
      },
      { availableAt: publishAt }
    );
    return { ok: true, publishAt };
  });
}

/** Takes a scheduled post back to a draft; its delivery then does nothing. */
export async function unschedulePost(
  ctx: PostsContext,
  input: { postId: string }
): Promise<UnschedulePostResult> {
  const { role } = await authorize(ctx, "cms.post.publish");
  return withMove(ctx, input.postId, "unschedule", async (tx, post, to) => {
    await move(
      tx,
      ctx,
      post,
      "unscheduled",
      {
        status: to,
        publishAt: null,
        publishedAt: post.publishedAt,
        archivedAt: null,
      },
      role
    );
    return { ok: true } as const;
  });
}

/** Puts a draft or a scheduled post live now, if it is ready to go live. */
export async function publishPost(
  ctx: PostsContext,
  input: { postId: string }
): Promise<PublishPostResult> {
  const { role } = await authorize(ctx, "cms.post.publish");
  return withMove(
    ctx,
    input.postId,
    "publish",
    async (tx, post, to): Promise<PublishPostResult> => {
      const refused = await goingLiveRefusal(tx, post.id, post);
      if (refused) return refused;
      const now = ctx.clock.now();
      // A scheduled post already due has been public since its instant
      // (publicPostFilter), so it keeps that date.
      const publishedAt =
        post.status === "scheduled" && post.publishAt && isPostPublic(post, now)
          ? post.publishAt
          : now;
      await move(
        tx,
        ctx,
        post,
        "published",
        { status: to, publishAt: null, publishedAt, archivedAt: null },
        role
      );
      await announcePublished(tx, ctx.clock, post.id);
      return { ok: true, publishedAt, tags: postTags(post.slug) };
    }
  );
}

/** Takes a published post off the public site. */
export async function archivePost(
  ctx: PostsContext,
  input: { postId: string }
): Promise<ArchivePostResult> {
  const { role } = await authorize(ctx, "cms.post.publish");
  return withMove(ctx, input.postId, "archive", async (tx, post, to) => {
    await move(
      tx,
      ctx,
      post,
      "archived",
      {
        status: to,
        publishAt: null,
        publishedAt: post.publishedAt,
        archivedAt: ctx.clock.now(),
      },
      role
    );
    return { ok: true, tags: postTags(post.slug) } as const;
  });
}

/** Makes an archived post a draft again. */
export async function restorePost(
  ctx: PostsContext,
  input: { postId: string }
): Promise<RestorePostResult> {
  const { role } = await authorize(ctx, "cms.post.publish");
  return withMove(ctx, input.postId, "restore", async (tx, post, to) => {
    await move(
      tx,
      ctx,
      post,
      "restored",
      {
        status: to,
        publishAt: null,
        publishedAt: post.publishedAt,
        archivedAt: null,
      },
      role
    );
    return { ok: true } as const;
  });
}

/** The worker, as the scheduled publishes run. */
const WORKER: Actor = { kind: "system", process: "worker" };

/**
 * The cms.post_scheduled handler: puts the post live if it is still
 * scheduled for the instant this delivery carries, dated to that instant.
 * A stale delivery does nothing; one that arrives early is saved again
 * for the instant. A post that no longer meets what going live needs (a
 * row changed behind the use cases' back) goes back to a draft instead,
 * which also takes it out of publicPostFilter.
 */
export async function publishScheduledPost(
  deps: { db: AppDb; clock: Clock },
  payload: { postId: string; publishAt: string }
): Promise<void> {
  const ctx = { clock: deps.clock, actor: WORKER };
  const job = { publishAt: new Date(payload.publishAt) };
  await deps.db.transaction(async (tx) => {
    const post = await loadPost(tx, payload.postId, { lock: true });
    if (!post) return;
    const decision = decideScheduledPublish(post, job, deps.clock.now());
    if (decision.action === "skip") return;
    if (decision.action === "wait") {
      await emit(
        tx,
        deps.clock,
        {
          type: "cms.post_scheduled",
          aggregate: { type: "cms_post", id: post.id },
          payload: { postId: post.id, publishAt: payload.publishAt },
        },
        { availableAt: decision.until }
      );
      return;
    }
    if (await goingLiveRefusal(tx, post.id, post)) {
      await move(
        tx,
        ctx,
        post,
        "unscheduled",
        {
          status: "draft",
          publishAt: null,
          publishedAt: post.publishedAt,
          archivedAt: null,
        },
        null
      );
      return;
    }
    await move(
      tx,
      ctx,
      post,
      "published",
      {
        status: "published",
        publishAt: null,
        publishedAt: decision.publishedAt,
        archivedAt: null,
      },
      null
    );
    await announcePublished(tx, deps.clock, post.id);
  });
}
