CREATE TYPE "public"."contact_close_reason" AS ENUM('resolved', 'no_action_needed', 'spam', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."contact_message_status" AS ENUM('new', 'in_progress', 'closed');--> statement-breakpoint
CREATE TYPE "public"."contact_topic" AS ENUM('GENERAL', 'SCHOOLS', 'NGOS', 'ADOPTION', 'VOLUNTEERING', 'DONATIONS', 'MEDIA');--> statement-breakpoint
CREATE TABLE "contact_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"topic" "contact_topic" NOT NULL,
	"team" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organisation" text,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" "contact_message_status" DEFAULT 'new' NOT NULL,
	"close_reason" "contact_close_reason",
	"assigned_to_user_id" uuid,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "contact_message_reference_unique" UNIQUE("reference"),
	CONSTRAINT "contact_message_team_known" CHECK ("contact_message"."team" IN ('staff_admin', 'competition_manager', 'community_manager', 'adoption_coordinator', 'finance', 'content_manager')),
	CONSTRAINT "contact_message_closed_with_reason" CHECK (("contact_message"."status" = 'closed') = ("contact_message"."close_reason" IS NOT NULL AND "contact_message"."closed_at" IS NOT NULL)),
	CONSTRAINT "contact_message_name_length" CHECK (char_length("contact_message"."name") BETWEEN 1 AND 100),
	CONSTRAINT "contact_message_email_length" CHECK (char_length("contact_message"."email") BETWEEN 1 AND 254),
	CONSTRAINT "contact_message_organisation_length" CHECK ("contact_message"."organisation" IS NULL OR char_length("contact_message"."organisation") BETWEEN 1 AND 150),
	CONSTRAINT "contact_message_subject_length" CHECK (char_length("contact_message"."subject") BETWEEN 1 AND 150),
	CONSTRAINT "contact_message_message_length" CHECK (char_length("contact_message"."message") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "contact_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_note_body_length" CHECK (char_length("contact_note"."body") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "form_rate_limit" (
	"form" text NOT NULL,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "form_rate_limit_form_scope_key_hash_window_start_pk" PRIMARY KEY("form","scope","key_hash","window_start"),
	CONSTRAINT "form_rate_limit_count_positive" CHECK ("form_rate_limit"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "human_check_redemption" (
	"salt" text PRIMARY KEY NOT NULL,
	"redeemed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_message" ADD CONSTRAINT "contact_message_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_message_id_contact_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."contact_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_message_team_status_created_at_idx" ON "contact_message" USING btree ("team","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_message_assigned_to_user_id_idx" ON "contact_message" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "contact_note_message_id_created_at_idx" ON "contact_note" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "form_rate_limit_window_start_idx" ON "form_rate_limit" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "human_check_redemption_redeemed_at_idx" ON "human_check_redemption" USING btree ("redeemed_at");