// Blog posts and stories (#112). A post's body is the stored, sanitised
// block shape (src/server/rich-text/post-body.ts), never HTML. Its images
// are uploads attached to the post (`cms_post_image`): the public site shows
// only their resized public copies, never the original file. Every status
// change goes through `nextPostStatus` (src/server/modules/cms/domain/
// post-status.ts); the checks below hold every writer to the same shape.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  POST_AUDIENCES,
  POST_KINDS,
} from "../../modules/cms/domain/post-kinds";
import { POST_STATUSES } from "../../modules/cms/domain/post-status";
import type { PostBody } from "../../rich-text/post-body";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const postStatus = pgEnum("post_status", POST_STATUSES);
export const postKind = pgEnum("post_kind", POST_KINDS);
export const postAudience = pgEnum("post_audience", POST_AUDIENCES);

export const cmsPost = pgTable(
  "cms_post",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    /** The address: /blog/<slug>. Unique across every status. */
    slug: text().notNull().unique(),
    kind: postKind().notNull(),
    title: text().notNull(),
    /** Shown in search results and the tab instead of a long title. */
    seoTitle: text("seo_title"),
    excerpt: text().notNull(),
    /** One or two sentences at grade 6 or below. */
    easyRead: text("easy_read"),
    audience: postAudience().notNull().default("everyone"),
    topics: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    featured: boolean().notNull().default(false),
    authorName: text("author_name"),
    /** Sanitised on every save and every read. */
    body: jsonb().$type<PostBody>().notNull(),
    /** An uploaded cover, shown through its public copy. */
    coverImageId: uuid("cover_image_id").references(
      (): AnyPgColumn => cmsPostImage.id,
      { onDelete: "set null" }
    ),
    /** Or a photo from the site's library (SITE_IMAGE_IDS). */
    coverSiteImageId: text("cover_site_image_id"),
    status: postStatus().notNull().default("draft"),
    /** The instant a scheduled post goes live. */
    publishAt: timestamptz("publish_at"),
    /** When it went live: a scheduled post's own instant, or "publish now". */
    publishedAt: timestamptz("published_at"),
    archivedAt: timestamptz("archived_at"),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("cms_post_status_published_at_idx").on(
      table.status,
      table.publishedAt.desc()
    ),
    check(
      "cms_post_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${table.slug}) BETWEEN 3 AND 80`
    ),
    check(
      "cms_post_one_cover",
      sql`${table.coverImageId} IS NULL OR ${table.coverSiteImageId} IS NULL`
    ),
    check(
      "cms_post_publish_at_when_scheduled",
      sql`(${table.status} = 'scheduled') = (${table.publishAt} IS NOT NULL)`
    ),
    check(
      "cms_post_published_at_when_published",
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`
    ),
    check(
      "cms_post_archived_at_when_archived",
      sql`(${table.status} = 'archived') = (${table.archivedAt} IS NOT NULL)`
    ),
  ]
);

/** An image uploaded for one post: its cover or one in its body. */
export const cmsPostImage = pgTable("cms_post_image", {
  /** UUIDv7. Bodies and the cover name images by this id. */
  id: uuid().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references((): AnyPgColumn => cmsPost.id, { onDelete: "cascade" }),
  /** The private original (#63). One post image per upload. */
  fileAssetId: uuid("file_asset_id").notNull().unique(),
  alt: text().notNull(),
  /** When its public copies were written; until then it can't go live. */
  publicAt: timestamptz("public_at"),
  createdAt: timestamptz("created_at").notNull(),
});

export type CmsPost = typeof cmsPost.$inferSelect;
export type CmsPostImage = typeof cmsPostImage.$inferSelect;
