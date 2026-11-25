CREATE TYPE "public"."adoption_application_status" AS ENUM('submitted', 'under_review', 'in_contact', 'adopted', 'not_matched', 'declined', 'withdrawn', 'listing_closed');--> statement-breakpoint
CREATE TYPE "public"."adoption_story_status" AS ENUM('draft', 'published', 'withdrawn');--> statement-breakpoint
CREATE TABLE "adoption_application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"adoption_listing_id" uuid NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"participant_profile_id" uuid,
	"date_of_birth_ciphertext" text NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"address_ciphertext" text NOT NULL,
	"answers_ciphertext" text NOT NULL,
	"contact_sharing_consent_id" uuid NOT NULL,
	"status" "adoption_application_status" NOT NULL,
	"contact_shared_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"outcome_reason_ciphertext" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "adoption_application_closed_at_matches_status" CHECK (("adoption_application"."status" IN ('submitted', 'under_review', 'in_contact')) = ("adoption_application"."closed_at" IS NULL)),
	CONSTRAINT "adoption_application_reason_when_ended" CHECK (("adoption_application"."status" IN ('not_matched', 'declined')) = ("adoption_application"."outcome_reason_ciphertext" IS NOT NULL)),
	CONSTRAINT "adoption_application_contact_shared" CHECK ("adoption_application"."status" NOT IN ('in_contact', 'adopted') OR "adoption_application"."contact_shared_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "adoption_story" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "adoption_story_status" NOT NULL,
	"consent_event_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "adoption_story_published_at_matches_status" CHECK ("adoption_story"."status" <> 'published' OR "adoption_story"."published_at" IS NOT NULL),
	CONSTRAINT "adoption_story_withdrawn_at_matches_status" CHECK (("adoption_story"."status" = 'withdrawn') = ("adoption_story"."withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "adoption_application" ADD CONSTRAINT "adoption_application_adoption_listing_id_adoption_listing_id_fk" FOREIGN KEY ("adoption_listing_id") REFERENCES "public"."adoption_listing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_application" ADD CONSTRAINT "adoption_application_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_application" ADD CONSTRAINT "adoption_application_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_application" ADD CONSTRAINT "adoption_application_contact_sharing_consent_id_consent_event_id_fk" FOREIGN KEY ("contact_sharing_consent_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_application" ADD CONSTRAINT "adoption_application_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_story" ADD CONSTRAINT "adoption_story_application_id_adoption_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."adoption_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_story" ADD CONSTRAINT "adoption_story_consent_event_id_consent_event_id_fk" FOREIGN KEY ("consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_story" ADD CONSTRAINT "adoption_story_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_application_one_open_per_listing" ON "adoption_application" USING btree ("adoption_listing_id","applicant_user_id") WHERE "adoption_application"."status" IN ('submitted', 'under_review', 'in_contact');--> statement-breakpoint
CREATE INDEX "adoption_application_applicant_idx" ON "adoption_application" USING btree ("applicant_user_id","created_at");--> statement-breakpoint
CREATE INDEX "adoption_application_status_created_idx" ON "adoption_application" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "adoption_application_participant_profile_idx" ON "adoption_application" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "adoption_application_decided_by_idx" ON "adoption_application" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "adoption_application_consent_idx" ON "adoption_application" USING btree ("contact_sharing_consent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_story_application_unique" ON "adoption_story" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "adoption_story_status_published_idx" ON "adoption_story" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "adoption_story_consent_idx" ON "adoption_story" USING btree ("consent_event_id");--> statement-breakpoint
CREATE INDEX "adoption_story_published_by_idx" ON "adoption_story" USING btree ("published_by_user_id");