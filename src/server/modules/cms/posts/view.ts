import type {
  PostBodyView,
  PostImage,
} from "@/server/modules/cms/domain/post-view";
import type { PostBody } from "@/server/rich-text/post-body";

export type PublicPostImage = Extract<PostImage, { source: "public" }>;

export function postBodyView(
  _body: PostBody,
  _publicImages: ReadonlyMap<string, PublicPostImage>
): PostBodyView {
  return { blocks: [], footnotes: [] };
}
