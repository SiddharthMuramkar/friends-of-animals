CREATE TYPE "public"."consent_link_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."consent_link_status" AS ENUM('pending', 'used', 'revoked');--> statement-breakpoint
CREATE TABLE "consent_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"institution_registration_id" uuid NOT NULL,
	"student_registration_id" uuid NOT NULL,
	"channel" "consent_link_channel" NOT NULL,
	"contact_ciphertext" text NOT NULL,
	"contact_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text,
	"status" "consent_link_status" DEFAULT 'pending' NOT NULL,
	"offered_uses" jsonb NOT NULL,
	"sent_by_user_id" uuid,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"codes_sent" integer DEFAULT 0 NOT NULL,
	"last_code_sent_at" timestamp with time zone,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"session_token_hash" text,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"answers" jsonb,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "consent_link_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "consent_link_closed_state" CHECK (("consent_link"."status" = 'used') = ("consent_link"."used_at" IS NOT NULL)
          AND ("consent_link"."status" = 'used') = ("consent_link"."answers" IS NOT NULL)
          AND ("consent_link"."status" = 'revoked') = ("consent_link"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "consent_event" ADD COLUMN "giver_contact_hash" text;--> statement-breakpoint
ALTER TABLE "consent_event" ADD COLUMN "consent_link_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_link" ADD CONSTRAINT "consent_link_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_link" ADD CONSTRAINT "consent_link_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_link" ADD CONSTRAINT "consent_link_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_link" ADD CONSTRAINT "consent_link_student_registration_id_registration_id_fk" FOREIGN KEY ("student_registration_id") REFERENCES "public"."registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_link" ADD CONSTRAINT "consent_link_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_link_pending_student_competition" ON "consent_link" USING btree ("participant_profile_id","competition_id") WHERE "consent_link"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "consent_link_school_registration_idx" ON "consent_link" USING btree ("institution_registration_id");--> statement-breakpoint
CREATE INDEX "consent_link_competition_idx" ON "consent_link" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "consent_link_profile_idx" ON "consent_link" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "consent_link_student_registration_idx" ON "consent_link" USING btree ("student_registration_id");--> statement-breakpoint
CREATE INDEX "consent_link_sender_idx" ON "consent_link" USING btree ("sent_by_user_id");--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_consent_link_id_consent_link_id_fk" FOREIGN KEY ("consent_link_id") REFERENCES "public"."consent_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_link_purpose_unique" UNIQUE("consent_link_id","purpose");--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_link_evidence" CHECK (("consent_event"."method" = 'otp_link') = ("consent_event"."consent_link_id" IS NOT NULL)
        AND ("consent_event"."method" <> 'otp_link' OR (
          "consent_event"."giver_user_id" IS NULL AND "consent_event"."giver_contact_hash" IS NOT NULL
          AND "consent_event"."subject_type" = 'participant_profile'
          AND "consent_event"."competition_id" IS NOT NULL
        )));