CREATE TYPE "public"."social_export_status" AS ENUM('pending', 'posted');--> statement-breakpoint
CREATE TABLE "social_export" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gallery_item_id" uuid NOT NULL,
	"gallery_consent_event_id" uuid NOT NULL,
	"social_consent_event_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption_ciphertext" text NOT NULL,
	"status" "social_export_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	CONSTRAINT "social_export_gallery_item_id_unique" UNIQUE("gallery_item_id")
);
--> statement-breakpoint
ALTER TABLE "social_export" ADD CONSTRAINT "social_export_gallery_item_id_gallery_item_id_fk" FOREIGN KEY ("gallery_item_id") REFERENCES "public"."gallery_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_export" ADD CONSTRAINT "social_export_gallery_consent_event_id_consent_event_id_fk" FOREIGN KEY ("gallery_consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_export" ADD CONSTRAINT "social_export_social_consent_event_id_consent_event_id_fk" FOREIGN KEY ("social_consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_export" ADD CONSTRAINT "social_export_file_id_file_asset_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;