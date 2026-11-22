CREATE TYPE "public"."post_audience" AS ENUM('kids', 'families', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."post_kind" AS ENUM('blog', 'story');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'scheduled', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "cms_post" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" "post_kind" NOT NULL,
	"title" text NOT NULL,
	"seo_title" text,
	"excerpt" text NOT NULL,
	"easy_read" text,
	"audience" "post_audience" DEFAULT 'everyone' NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"author_name" text,
	"body" jsonb NOT NULL,
	"cover_image_id" uuid,
	"cover_site_image_id" text,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cms_post_slug_unique" UNIQUE("slug"),
	CONSTRAINT "cms_post_slug_format" CHECK ("cms_post"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("cms_post"."slug") BETWEEN 3 AND 80),
	CONSTRAINT "cms_post_one_cover" CHECK ("cms_post"."cover_image_id" IS NULL OR "cms_post"."cover_site_image_id" IS NULL),
	CONSTRAINT "cms_post_publish_at_when_scheduled" CHECK (("cms_post"."status" = 'scheduled') = ("cms_post"."publish_at" IS NOT NULL)),
	CONSTRAINT "cms_post_published_at_when_published" CHECK ("cms_post"."status" <> 'published' OR "cms_post"."published_at" IS NOT NULL),
	CONSTRAINT "cms_post_archived_at_when_archived" CHECK (("cms_post"."status" = 'archived') = ("cms_post"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "cms_post_image" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"alt" text NOT NULL,
	"public_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cms_post_image_file_asset_id_unique" UNIQUE("file_asset_id")
);
--> statement-breakpoint
ALTER TABLE "cms_post" ADD CONSTRAINT "cms_post_cover_image_id_cms_post_image_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."cms_post_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_post" ADD CONSTRAINT "cms_post_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_post" ADD CONSTRAINT "cms_post_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_post_image" ADD CONSTRAINT "cms_post_image_post_id_cms_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."cms_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cms_post_status_published_at_idx" ON "cms_post" USING btree ("status","published_at" DESC NULLS LAST);