CREATE TYPE "public"."consent_form_rejection_reason" AS ENUM('illegible', 'not_signed', 'wrong_student', 'wrong_competition', 'uses_unclear', 'other');--> statement-breakpoint
CREATE TYPE "public"."consent_form_status" AS ENUM('pending_review', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "consent_form" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"institution_registration_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"uses" text[] NOT NULL,
	"documents" jsonb NOT NULL,
	"status" "consent_form_status" DEFAULT 'pending_review' NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" "consent_form_rejection_reason",
	"rejection_note" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "consent_form_file_asset_id_unique" UNIQUE("file_asset_id"),
	CONSTRAINT "consent_form_uses_known" CHECK (cardinality("consent_form"."uses") > 0 AND "consent_form"."uses" <@ ARRAY['public_display', 'display_school', 'display_city', 'social_media', 'auction']::text[]),
	CONSTRAINT "consent_form_reviewed_iff_decided" CHECK (CASE WHEN "consent_form"."status" IN ('accepted', 'rejected')
        THEN "consent_form"."reviewed_by_user_id" IS NOT NULL AND "consent_form"."reviewed_at" IS NOT NULL
        ELSE "consent_form"."reviewed_by_user_id" IS NULL AND "consent_form"."reviewed_at" IS NULL END),
	CONSTRAINT "consent_form_reason_iff_rejected" CHECK (("consent_form"."status" = 'rejected') = ("consent_form"."rejection_reason" IS NOT NULL)),
	CONSTRAINT "consent_form_note_only_on_rejection" CHECK ("consent_form"."rejection_note" IS NULL OR ("consent_form"."status" = 'rejected' AND char_length("consent_form"."rejection_note") <= 500)),
	CONSTRAINT "consent_form_withdrawn_iff_withdrawn" CHECK (("consent_form"."status" = 'withdrawn') = ("consent_form"."withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "consent_form_upload" (
	"file_asset_id" uuid PRIMARY KEY NOT NULL,
	"registration_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_event" ADD COLUMN "consent_form_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_event" ADD COLUMN "reviewer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD COLUMN "participation_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD COLUMN "participation_declared_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_form" ADD CONSTRAINT "consent_form_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form" ADD CONSTRAINT "consent_form_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form" ADD CONSTRAINT "consent_form_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form" ADD CONSTRAINT "consent_form_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form" ADD CONSTRAINT "consent_form_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form" ADD CONSTRAINT "consent_form_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_upload" ADD CONSTRAINT "consent_form_upload_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_upload" ADD CONSTRAINT "consent_form_upload_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_form_one_pending_idx" ON "consent_form" USING btree ("participant_profile_id","competition_id") WHERE "consent_form"."status" = 'pending_review';--> statement-breakpoint
CREATE INDEX "consent_form_status_submitted_idx" ON "consent_form" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "consent_form_registration_idx" ON "consent_form" USING btree ("institution_registration_id","participant_profile_id");--> statement-breakpoint
CREATE INDEX "consent_form_participant_profile_id_idx" ON "consent_form" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "consent_form_competition_id_idx" ON "consent_form" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "consent_form_uploaded_by_user_id_idx" ON "consent_form" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "consent_form_reviewed_by_user_id_idx" ON "consent_form" USING btree ("reviewed_by_user_id");--> statement-breakpoint
CREATE INDEX "consent_form_upload_registration_id_idx" ON "consent_form_upload" USING btree ("registration_id");--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_consent_form_id_consent_form_id_fk" FOREIGN KEY ("consent_form_id") REFERENCES "public"."consent_form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_participation_declared_by_user_id_user_id_fk" FOREIGN KEY ("participation_declared_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_event_consent_form_id_idx" ON "consent_event" USING btree ("consent_form_id");--> statement-breakpoint
CREATE INDEX "consent_event_reviewer_user_id_idx" ON "consent_event" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "institution_registration_participation_declared_by_user_id_idx" ON "institution_registration" USING btree ("participation_declared_by_user_id");--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_signed_form_evidence" CHECK ("consent_event"."consent_form_id" IS NULL OR ("consent_event"."method" = 'paper_form' AND "consent_event"."reviewer_user_id" IS NOT NULL AND "consent_event"."giver_user_id" IS NULL));