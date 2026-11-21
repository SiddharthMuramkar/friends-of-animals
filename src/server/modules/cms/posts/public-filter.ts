// Which posts the public site may show at an instant: the SQL form of
// `isPostPublic` (../domain/post-status.ts). A published post from its
// publish instant, and a scheduled post from the instant it is scheduled
// for, even before the publish job has run, so a busy or stopped worker
// never holds a post back. Drafts and archived posts never match. Every
// public read of posts (#112b) filters with this.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, lte, or, type SQL } from "drizzle-orm";

import { cmsPost } from "../../../db/schema";

export function publicPostFilter(now: Date): SQL {
  return or(
    and(eq(cmsPost.status, "published"), lte(cmsPost.publishedAt, now)),
    and(eq(cmsPost.status, "scheduled"), lte(cmsPost.publishAt, now))
  )!;
}
