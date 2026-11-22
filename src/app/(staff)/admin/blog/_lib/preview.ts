// The editor's preview of a saved post (#112): its body in the published
// stories' shape, so the blog's own article renderer shows it as it will
// read. A site photo shows as it will; an uploaded image shows as a note
// with its alt text, because the original is private and the preview never
// asks for it. Pure, so it is tested without a page.

import type { ArticleBody, Block } from "@/content/stories";
import type { PostImageSummary } from "@/server/modules/cms";
import type { PostBlock, PostBody } from "@/server/rich-text/post-body";

export type PreviewWords = {
  image: string;
  ready: (alt: string) => string;
  notReady: (alt: string) => string;
  noAlt: string;
};

function blockOf(
  block: PostBlock,
  images: ReadonlyMap<string, PostImageSummary>,
  words: PreviewWords
): Block {
  if (block.type !== "image") return block as Block;
  if ("siteImageId" in block) {
    return {
      type: "image",
      imageId: block.siteImageId,
      ...(block.caption ? { caption: block.caption } : {}),
    };
  }
  const image = images.get(block.postImageId);
  const alt = image?.alt || words.noAlt;
  return {
    type: "callout",
    tone: "info",
    title: words.image,
    body: [
      [image?.ready ? words.ready(alt) : words.notReady(alt)],
      ...(block.caption ? [[block.caption]] : []),
    ],
  };
}

export function previewBody(
  body: PostBody,
  images: readonly PostImageSummary[],
  words: PreviewWords
): ArticleBody {
  const byId = new Map(images.map((image) => [image.id, image]));
  return {
    blocks: body.blocks.map((block) => blockOf(block, byId, words)),
    footnotes: body.footnotes,
  } as ArticleBody;
}
