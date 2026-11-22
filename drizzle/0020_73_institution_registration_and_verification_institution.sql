CREATE TYPE "public"."institution_status" AS ENUM('pending_verification', 'verified', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."institution_type" AS ENUM('school', 'college', 'university', 'other');--> statement-breakpoint
CREATE TABLE "institution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "institution_type" NOT NULL,
	"address" text NOT NULL,
	"pin_code" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"country" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"principal_name" text NOT NULL,
	"principal_email_ciphertext" text NOT NULL,
	"principal_phone_ciphertext" text NOT NULL,
	"expected_participants" integer NOT NULL,
	"status" "institution_status" DEFAULT 'pending_verification' NOT NULL,
	"status_reason" text,
	"institution_code" text,
	"created_by" uuid NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "institution_institution_code_unique" UNIQUE("institution_code"),
	CONSTRAINT "institution_pin_code_format" CHECK ("institution"."pin_code" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "institution_expected_participants_range" CHECK ("institution"."expected_participants" BETWEEN 1 AND 100000),
	CONSTRAINT "institution_code_matches_status" CHECK (("institution"."institution_code" IS NOT NULL) = ("institution"."status" IN ('verified', 'suspended'))),
	CONSTRAINT "institution_verified_at_matches_code" CHECK (("institution"."verified_at" IS NOT NULL) = ("institution"."institution_code" IS NOT NULL)),
	CONSTRAINT "institution_reason_matches_status" CHECK (("institution"."status_reason" IS NULL) = ("institution"."status" = 'pending_verification'))
);
--> statement-breakpoint
ALTER TABLE "institution" ADD CONSTRAINT "institution_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution" ADD CONSTRAINT "institution_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "institution_one_open_per_creator" ON "institution" USING btree ("created_by") WHERE "institution"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "institution_status_created_at_idx" ON "institution" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "institution_created_by_idx" ON "institution" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "institution_verified_by_idx" ON "institution" USING btree ("verified_by");