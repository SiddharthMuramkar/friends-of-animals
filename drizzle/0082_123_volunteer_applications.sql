CREATE TYPE "public"."volunteer_application_status" AS ENUM('awaiting_guardian', 'guardian_declined', 'submitted', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."volunteer_interest" AS ENUM('technology', 'content', 'outreach', 'competition_management', 'social_media', 'community_building');--> statement-breakpoint
CREATE TABLE "volunteer_application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"participant_profile_id" uuid,
	"date_of_birth_ciphertext" text NOT NULL,
	"interests" "volunteer_interest"[] NOT NULL,
	"availability" jsonb NOT NULL,
	"status" "volunteer_application_status" NOT NULL,
	"guardian_user_id" uuid,
	"guardian_decided_at" timestamp with time zone,
	"safeguarding_consent_id" uuid,
	"conduct_consent_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason_ciphertext" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "volunteer_application_has_interests" CHECK (cardinality("volunteer_application"."interests") > 0),
	CONSTRAINT "volunteer_application_closed_at_matches_status" CHECK (("volunteer_application"."status" IN ('awaiting_guardian', 'submitted')) = ("volunteer_application"."closed_at" IS NULL)),
	CONSTRAINT "volunteer_application_approval_recorded" CHECK ("volunteer_application"."status" <> 'approved' OR ("volunteer_application"."safeguarding_consent_id" IS NOT NULL AND "volunteer_application"."conduct_consent_id" IS NOT NULL AND "volunteer_application"."decided_at" IS NOT NULL)),
	CONSTRAINT "volunteer_application_decline_has_reason" CHECK ("volunteer_application"."status" <> 'declined' OR ("volunteer_application"."decline_reason_ciphertext" IS NOT NULL AND "volunteer_application"."decided_at" IS NOT NULL)),
	CONSTRAINT "volunteer_application_reason_only_when_declined" CHECK ("volunteer_application"."status" = 'declined' OR "volunteer_application"."decline_reason_ciphertext" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "volunteer_application" ADD CONSTRAINT "volunteer_application_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_application" ADD CONSTRAINT "volunteer_application_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_application" ADD CONSTRAINT "volunteer_application_guardian_user_id_user_id_fk" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_application" ADD CONSTRAINT "volunteer_application_safeguarding_consent_id_consent_event_id_fk" FOREIGN KEY ("safeguarding_consent_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_application" ADD CONSTRAINT "volunteer_application_conduct_consent_id_consent_event_id_fk" FOREIGN KEY ("conduct_consent_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_application" ADD CONSTRAINT "volunteer_application_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_application_one_open_per_applicant" ON "volunteer_application" USING btree ("applicant_user_id") WHERE "volunteer_application"."status" IN ('awaiting_guardian', 'submitted');--> statement-breakpoint
CREATE INDEX "volunteer_application_applicant_user_id_idx" ON "volunteer_application" USING btree ("applicant_user_id");--> statement-breakpoint
CREATE INDEX "volunteer_application_status_created_at_idx" ON "volunteer_application" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "volunteer_application_participant_profile_id_idx" ON "volunteer_application" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "volunteer_application_guardian_user_id_idx" ON "volunteer_application" USING btree ("guardian_user_id");--> statement-breakpoint
CREATE INDEX "volunteer_application_decided_by_user_id_idx" ON "volunteer_application" USING btree ("decided_by_user_id");