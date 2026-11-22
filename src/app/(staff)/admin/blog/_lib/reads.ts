import "server-only";

import type { UseCases } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { GetPostForEditResult, PostSummary } from "@/server/modules/cms";

// The admin blog pages' reads (#112). Each answers null (or false) when the
// actor may not edit posts, so the page shows its "only content managers"
// state; anything else a use case throws is a bug and propagates.

async function orDenied<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") return null;
    throw error;
  }
}

/** Whether the actor may write posts, without reading any. */
export async function mayWritePosts(useCases: UseCases): Promise<boolean> {
  const allowed = await orDenied(async () => {
    await useCases.checkPostWriter();
    return true;
  });
  return allowed ?? false;
}

/** Every post, or null if the actor may not edit posts. */
export function postsFor(useCases: UseCases): Promise<PostSummary[] | null> {
  return orDenied(() => useCases.listPosts());
}

/** One post for its editor, or null if the actor may not edit posts. */
export function postFor(
  useCases: UseCases,
  postId: string
): Promise<GetPostForEditResult | null> {
  return orDenied(() => useCases.getPostForEdit({ postId }));
}
