CREATE TYPE "public"."gallery_item_status" AS ENUM('draft', 'published', 'hidden', 'unpublished');--> statement-breakpoint
CREATE TYPE "public"."gallery_purge_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gallery_report_reason" AS ENUM('identifies_child', 'inappropriate_content', 'wrong_credit', 'other');--> statement-breakpoint
CREATE TYPE "public"."gallery_report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TABLE "gallery_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"consent_event_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"status" "gallery_item_status" NOT NULL,
	"title" text NOT NULL,
	"story" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gallery_item_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "gallery_purge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"status" "gallery_purge_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"overdue_alerted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"reason" "gallery_report_reason" NOT NULL,
	"details_ciphertext" text,
	"contact_ciphertext" text,
	"status" "gallery_report_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "gallery_item" ADD CONSTRAINT "gallery_item_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_item" ADD CONSTRAINT "gallery_item_consent_event_id_consent_event_id_fk" FOREIGN KEY ("consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_item" ADD CONSTRAINT "gallery_item_file_id_file_asset_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_report" ADD CONSTRAINT "gallery_report_item_id_gallery_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."gallery_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_report" ADD CONSTRAINT "gallery_report_handled_by_user_id_user_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gallery_item_status_created_idx" ON "gallery_item" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "gallery_report_status_created_idx" ON "gallery_report" USING btree ("status","created_at");