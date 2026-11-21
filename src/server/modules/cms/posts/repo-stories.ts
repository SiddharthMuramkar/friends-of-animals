import type { PostCard, PostView } from "@/server/modules/cms/domain/post-view";

export function repoStoryCards(): PostCard[] {
  return [];
}

export async function repoStoryView(_slug: string): Promise<PostView | null> {
  return null;
}
