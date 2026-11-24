CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'sent');--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"subject" text NOT NULL,
	"event_at" timestamp with time zone,
	"confirmed_theme" text,
	"permitted_materials" text,
	"duration" text,
	"submission_steps" text,
	"physical_artwork_requirements" text,
	"deadlines" text,
	"help_contacts_ciphertext" text,
	"message" text,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"recipient_count" integer,
	CONSTRAINT "announcement_sent_stamped" CHECK (("announcement"."status" = 'sent') = ("announcement"."sent_at" IS NOT NULL) AND ("announcement"."sent_at" IS NULL) = ("announcement"."recipient_count" IS NULL)),
	CONSTRAINT "announcement_recipient_count_not_negative" CHECK ("announcement"."recipient_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "message_delivery" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "title_ciphertext" text;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "body_ciphertext" text;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD COLUMN "contact_hash" text;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD COLUMN "recipient_account_hash" text;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD COLUMN "recipient_hashes" text[];--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_competition_newest_idx" ON "announcement" USING btree ("competition_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "announcement_created_by_idx" ON "announcement" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "announcement_sent_by_idx" ON "announcement" USING btree ("sent_by");--> statement-breakpoint
CREATE INDEX "message_delivery_recipient_account_idx" ON "message_delivery" USING btree ("event_id","template_key","channel","recipient_account_hash");--> statement-breakpoint
CREATE INDEX "message_delivery_recipient_hashes_idx" ON "message_delivery" USING gin ("recipient_hashes");--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_contact_once" UNIQUE("event_id","template_key","contact_hash","channel");--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_one_recipient" CHECK (("message_delivery"."user_id" IS NULL) <> ("message_delivery"."contact_hash" IS NULL));