CREATE TYPE "public"."cms_revision_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TABLE "cms_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cms_document_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "cms_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer,
	"body" jsonb NOT NULL,
	"status" "cms_revision_status" NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "cms_revision_document_version_unique" UNIQUE("document_id","version"),
	CONSTRAINT "cms_revision_numbered_once_published" CHECK (("cms_revision"."status" = 'draft') = ("cms_revision"."version" IS NULL AND "cms_revision"."published_at" IS NULL)),
	CONSTRAINT "cms_revision_version_positive" CHECK ("cms_revision"."version" IS NULL OR "cms_revision"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "consent_document" ADD COLUMN "legal_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "cms_revision" ADD CONSTRAINT "cms_revision_document_id_cms_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cms_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_revision_one_draft" ON "cms_revision" USING btree ("document_id") WHERE "cms_revision"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "cms_revision_one_published" ON "cms_revision" USING btree ("document_id") WHERE "cms_revision"."status" = 'published';--> statement-breakpoint
ALTER TABLE "consent_document" ADD CONSTRAINT "consent_document_legal_revision_id_cms_revision_id_fk" FOREIGN KEY ("legal_revision_id") REFERENCES "public"."cms_revision"("id") ON DELETE no action ON UPDATE no action;