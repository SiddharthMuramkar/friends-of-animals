CREATE TYPE "public"."guardian_relationship" AS ENUM('parent', 'legal_guardian');--> statement-breakpoint
CREATE TYPE "public"."institution_registration_status" AS ENUM('active');--> statement-breakpoint
CREATE TYPE "public"."participant_owner_kind" AS ENUM('institution', 'self', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."registration_route" AS ENUM('institution', 'individual');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('enrolled', 'withdrawn');--> statement-breakpoint
CREATE TABLE "institution_registration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "institution_registration_status" DEFAULT 'active' NOT NULL,
	"registered_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "institution_registration_institution_competition_unique" UNIQUE("institution_id","competition_id"),
	CONSTRAINT "institution_registration_reference_unique" UNIQUE("reference"),
	CONSTRAINT "institution_registration_reference_format" CHECK ("institution_registration"."reference" ~ '^[A-Z]{3,6}[0-9]{2}-I-[0-9A-HJKMNP-TV-Z]{5}$')
);
--> statement-breakpoint
CREATE TABLE "participant_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_kind" "participant_owner_kind" NOT NULL,
	"managing_institution_id" uuid,
	"full_name" text NOT NULL,
	"dob_ciphertext" text NOT NULL,
	"grade" text,
	"student_ref" text,
	"phone_ciphertext" text,
	"email_ciphertext" text,
	"guardian_name_ciphertext" text,
	"guardian_relationship" "guardian_relationship",
	"guardian_phone_ciphertext" text,
	"guardian_email_ciphertext" text,
	"address_ciphertext" text,
	"pin_code" text,
	"city" text,
	"state" text,
	"identity_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "participant_profile_institution_owner" CHECK (("participant_profile"."managing_institution_id" IS NOT NULL) = ("participant_profile"."owner_kind" = 'institution')),
	CONSTRAINT "participant_profile_guardian_complete" CHECK (("participant_profile"."guardian_name_ciphertext" IS NULL) = ("participant_profile"."guardian_relationship" IS NULL) AND ("participant_profile"."guardian_name_ciphertext" IS NULL) = ("participant_profile"."guardian_phone_ciphertext" IS NULL)),
	CONSTRAINT "participant_profile_pin_code_format" CHECK ("participant_profile"."pin_code" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "registration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"route" "registration_route" NOT NULL,
	"institution_registration_id" uuid,
	"age_group_id" uuid NOT NULL,
	"status" "registration_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registration_institution_route" CHECK (("registration"."institution_registration_id" IS NOT NULL) = ("registration"."route" = 'institution'))
);
--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_managing_institution_id_institution_id_fk" FOREIGN KEY ("managing_institution_id") REFERENCES "public"."institution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_age_group_id_competition_age_group_id_fk" FOREIGN KEY ("age_group_id") REFERENCES "public"."competition_age_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "institution_registration_competition_id_idx" ON "institution_registration" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "institution_registration_registered_by_idx" ON "institution_registration" USING btree ("registered_by");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_profile_institution_identity_unique" ON "participant_profile" USING btree ("managing_institution_id","identity_hash") WHERE "participant_profile"."managing_institution_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "participant_profile_created_by_idx" ON "participant_profile" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_participant_competition_unique" ON "registration" USING btree ("participant_profile_id","competition_id") WHERE "registration"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "registration_institution_registration_id_idx" ON "registration" USING btree ("institution_registration_id");--> statement-breakpoint
CREATE INDEX "registration_competition_id_idx" ON "registration" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "registration_age_group_id_idx" ON "registration" USING btree ("age_group_id");