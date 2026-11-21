// What the public site shows of a blog post or story: the post as a visitor
// may see it, with every image already resolved to something public. Pages,
// the sitemap, the proxy's slug check and the structured data all read
// these shapes, whether the post came from the database or, on a build
// with no database, from the repo stories (src/content/stories).
//
// Pure types: no I/O, so pages, tests and the worker can import them.

import type { Audience, Block, Footnote } from "@/content/stories";
import type { SiteImageId } from "@/lib/images/credits";

/** Blog posts and stories share one model; the kind only labels them. */
export type PostKind = "blog" | "story";

/**
 * An image a visitor may load: one of the site's licensed photos, or the
 * public derivative of an uploaded image (never the original upload).
 */
export type PostImage =
  | { source: "site"; id: SiteImageId }
  | {
      source: "public";
      /** Absolute URL in the public bucket (or the app's fallback route). */
      url: string;
      width: number;
      height: number;
      alt: string;
    };

/** A body block as it renders: image blocks carry a resolved image. */
export type PostBlock =
  | Exclude<Block, { type: "image" }>
  | { type: "image"; image: PostImage; caption?: string | undefined };

export type PostBodyView = { blocks: PostBlock[]; footnotes: Footnote[] };

/** What a card or a list needs: everything but the body. */
export type PostCard = {
  slug: string;
  kind: PostKind;
  title: string;
  /** Shown in the browser tab and search results instead of the title. */
  seoTitle: string | null;
  /** The dek under the title and on cards. */
  excerpt: string;
  audience: Audience;
  topics: string[];
  featured: boolean;
  readingMinutes: number;
  /** Null: the card shows a tile-pattern cover. */
  cover: PostImage | null;
  publishedAt: Date;
  updatedAt: Date;
};

/** A whole published post. */
export type PostView = PostCard & {
  /** One or two sentences at grade 6 or below. */
  easyRead: string | null;
  /** Shown as the author; null means the organisation wrote it. */
  authorName: string | null;
  body: PostBodyView;
};
