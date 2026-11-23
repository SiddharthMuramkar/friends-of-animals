// From a stored post to what the public site shows (../domain/post-view.ts).
// A stored body names its images by id: a site photo, or an uploaded post
// image. An uploaded image shows only through its public copy (a resized
// derivative in the public bucket); without one, its block is left out,
// so a page can never fall back to the original upload.
//
// Pure: the caller looks up the public copies.

import type {
  PostBlockView,
  PostBodyView,
  PostImage,
} from "@/server/modules/cms/domain/post-view";
import type { PostBody } from "@/server/rich-text/post-body";

export type PublicPostImage = Extract<PostImage, { source: "public" }>;

/** The body with each image resolved, and images with no public copy left out. */
export function postBodyView(
  body: PostBody,
  publicImages: ReadonlyMap<string, PublicPostImage>
): PostBodyView {
  const blocks = body.blocks.flatMap((block): PostBlockView[] => {
    if (block.type !== "image") return [block];
    const caption = block.caption ? { caption: block.caption } : {};
    if ("siteImageId" in block) {
      return [
        {
          type: "image",
          image: { source: "site", id: block.siteImageId },
          ...caption,
        },
      ];
    }
    const image = publicImages.get(block.postImageId);
    return image ? [{ type: "image", image, ...caption }] : [];
  });
  return { blocks, footnotes: body.footnotes };
}
