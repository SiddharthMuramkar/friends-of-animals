CREATE TYPE "public"."entry_file_kind" AS ENUM('image', 'video', 'document', 'text');--> statement-breakpoint
CREATE TYPE "public"."entry_file_status" AS ENUM('pending', 'processing', 'live', 'rejected', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('processing', 'submitted', 'rejected', 'failed', 'school_shortlisted', 'not_shortlisted', 'submitted_to_foa', 'foa_verified', 'sent_back');--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"competition_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"discipline" "competition_discipline" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"statement" text,
	"status" "entry_status" NOT NULL,
	"created_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entry_code_unique" UNIQUE("code"),
	CONSTRAINT "entry_registration_id_unique" UNIQUE("registration_id"),
	CONSTRAINT "entry_code_format" CHECK ("entry"."code" ~ '^[A-Z]{3,6}[0-9]{2}-E-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "entry_title_length" CHECK (char_length("entry"."title") BETWEEN 1 AND 120),
	CONSTRAINT "entry_description_length" CHECK (char_length("entry"."description") BETWEEN 1 AND 500),
	CONSTRAINT "entry_statement_length" CHECK ("entry"."statement" IS NULL OR char_length("entry"."statement") BETWEEN 1 AND 1500),
	CONSTRAINT "entry_submitted_at_matches_status" CHECK (("entry"."status" <> 'submitted' OR "entry"."submitted_at" IS NOT NULL) AND ("entry"."status" NOT IN ('processing', 'rejected', 'failed') OR "entry"."submitted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "entry_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"kind" "entry_file_kind" NOT NULL,
	"file_asset_id" uuid,
	"status" "entry_file_status" NOT NULL,
	"pending_text" jsonb,
	"receipt_title" text,
	"uploaded_by_user_id" uuid,
	"upload_completed_at" timestamp with time zone NOT NULL,
	"became_live_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entry_file_file_asset_id_unique" UNIQUE("file_asset_id"),
	CONSTRAINT "entry_file_entry_id_attempt_number_unique" UNIQUE("entry_id","attempt_number"),
	CONSTRAINT "entry_file_asset_matches_kind" CHECK (("entry_file"."kind" = 'text') = ("entry_file"."file_asset_id" IS NULL)),
	CONSTRAINT "entry_file_became_live_at_matches_status" CHECK (("entry_file"."status" <> 'live' OR "entry_file"."became_live_at" IS NOT NULL) AND ("entry_file"."status" NOT IN ('pending', 'processing', 'rejected', 'failed') OR "entry_file"."became_live_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "entry_transition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"from_status" "entry_status",
	"to_status" "entry_status" NOT NULL,
	"trigger" text NOT NULL,
	"entry_file_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "entry_transition_entry_sequence_unique" UNIQUE("entry_id","sequence"),
	CONSTRAINT "entry_transition_actor_kind" CHECK ("entry_transition"."actor_kind" IN ('user', 'system')),
	CONSTRAINT "entry_transition_system_has_no_user" CHECK ("entry_transition"."actor_kind" = 'user' OR "entry_transition"."actor_user_id" IS NULL),
	CONSTRAINT "entry_transition_changes_status" CHECK ("entry_transition"."from_status" IS DISTINCT FROM "entry_transition"."to_status")
);
--> statement-breakpoint
CREATE TABLE "entry_upload_grant" (
	"file_asset_id" uuid PRIMARY KEY NOT NULL,
	"registration_id" uuid NOT NULL,
	"upload_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"prepared" boolean DEFAULT false NOT NULL,
	"retired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_file" ADD CONSTRAINT "entry_file_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_file" ADD CONSTRAINT "entry_file_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_file" ADD CONSTRAINT "entry_file_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transition" ADD CONSTRAINT "entry_transition_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transition" ADD CONSTRAINT "entry_transition_entry_file_id_entry_file_id_fk" FOREIGN KEY ("entry_file_id") REFERENCES "public"."entry_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transition" ADD CONSTRAINT "entry_transition_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_upload_grant" ADD CONSTRAINT "entry_upload_grant_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_upload_grant" ADD CONSTRAINT "entry_upload_grant_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_participant_profile_id_idx" ON "entry" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "entry_competition_id_status_idx" ON "entry" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "entry_created_by_user_id_idx" ON "entry" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_file_one_live_per_entry" ON "entry_file" USING btree ("entry_id") WHERE "entry_file"."status" = 'live';--> statement-breakpoint
CREATE INDEX "entry_file_uploaded_by_user_id_idx" ON "entry_file" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "entry_transition_entry_file_id_idx" ON "entry_transition" USING btree ("entry_file_id");--> statement-breakpoint
CREATE INDEX "entry_transition_actor_user_id_idx" ON "entry_transition" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "entry_upload_grant_registration_expiry_idx" ON "entry_upload_grant" USING btree ("registration_id","expires_at");
