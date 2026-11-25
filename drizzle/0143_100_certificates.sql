CREATE TYPE "public"."certificate_render_status" AS ENUM('pending', 'rendered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('issued', 'revoked', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."certificate_type" AS ENUM('participation', 'school_merit', 'finalist', 'winner', 'runner_up', 'volunteer_service');--> statement-breakpoint
CREATE TABLE "certificate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"type" "certificate_type" NOT NULL,
	"status" "certificate_status" DEFAULT 'issued' NOT NULL,
	"competition_id" uuid,
	"registration_id" uuid,
	"participant_profile_id" uuid NOT NULL,
	"entry_id" uuid,
	"school_round_id" uuid,
	"round_id" uuid,
	"award_position" integer,
	"award_label" text,
	"name_snapshot" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"render_status" "certificate_render_status" DEFAULT 'pending' NOT NULL,
	"render_attempts" integer DEFAULT 0 NOT NULL,
	"pdf_file_id" uuid,
	"issued_at" timestamp with time zone NOT NULL,
	"source_release_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoked_reason" text,
	"superseded_by_id" uuid,
	CONSTRAINT "certificate_number_unique" UNIQUE("number"),
	CONSTRAINT "certificate_pdf_unique" UNIQUE("pdf_file_id"),
	CONSTRAINT "certificate_number_format" CHECK ("certificate"."number" ~ '^FOA-C-[0-9]{2}-[0-9A-HJKMNP-TV-Z]{10}$'),
	CONSTRAINT "certificate_competition_pair" CHECK (("certificate"."competition_id" IS NULL) = ("certificate"."registration_id" IS NULL)),
	CONSTRAINT "certificate_round_kind" CHECK ("certificate"."school_round_id" IS NULL OR "certificate"."round_id" IS NULL),
	CONSTRAINT "certificate_attempts_nonnegative" CHECK ("certificate"."render_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "certificate_ready_notice" (
	"release_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "certificate_ready_notice_identity" UNIQUE("release_id","recipient_user_id")
);
--> statement-breakpoint
ALTER TABLE "file_asset" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_school_round_id_school_round_id_fk" FOREIGN KEY ("school_round_id") REFERENCES "public"."school_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_round_id_judging_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_pdf_file_id_file_asset_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."file_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_source_release_id_result_release_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."result_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_superseded_by_id_certificate_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."certificate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_ready_notice" ADD CONSTRAINT "certificate_ready_notice_release_id_result_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."result_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_ready_notice" ADD CONSTRAINT "certificate_ready_notice_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_earned_unique" ON "certificate" USING btree ("registration_id","type","school_round_id","round_id") WHERE "certificate"."status" <> 'superseded' AND "certificate"."registration_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_participation_identity" ON "certificate" USING btree ("registration_id","type") WHERE "certificate"."registration_id" IS NOT NULL AND "certificate"."school_round_id" IS NULL AND "certificate"."round_id" IS NULL AND "certificate"."status" <> 'superseded';--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_school_identity" ON "certificate" USING btree ("registration_id","type","school_round_id") WHERE "certificate"."school_round_id" IS NOT NULL AND "certificate"."status" <> 'superseded';--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_foa_identity" ON "certificate" USING btree ("registration_id","type","round_id") WHERE "certificate"."round_id" IS NOT NULL AND "certificate"."status" <> 'superseded';--> statement-breakpoint
CREATE INDEX "certificate_profile_idx" ON "certificate" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "certificate_competition_idx" ON "certificate" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "certificate_release_idx" ON "certificate" USING btree ("source_release_id");