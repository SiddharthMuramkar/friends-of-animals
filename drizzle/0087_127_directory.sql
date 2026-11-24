CREATE TYPE "public"."directory_document_kind" AS ENUM('registration_certificate', 'awbi_recognition', 'identity_proof', 'address_proof', 'other');--> statement-breakpoint
CREATE TYPE "public"."directory_listing_status" AS ENUM('pending_verification', 'verified', 'rejected', 'suspended', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."directory_listing_type" AS ENUM('ngo', 'rescue_organisation', 'shelter', 'independent_rescuer', 'foster_caregiver');--> statement-breakpoint
CREATE TYPE "public"."directory_service" AS ENUM('rescue', 'shelter', 'veterinary_care', 'ambulance', 'adoption', 'fostering', 'feeding', 'sterilisation', 'education');--> statement-breakpoint
CREATE TABLE "directory_listing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"type" "directory_listing_type" NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"services" "directory_service"[] NOT NULL,
	"address_ciphertext" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pin_code" text NOT NULL,
	"contact_phone_ciphertext" text NOT NULL,
	"contact_email_ciphertext" text,
	"website" text,
	"public_contact_fields" text[] NOT NULL,
	"status" "directory_listing_status" NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone NOT NULL,
	"status_changed_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "directory_listing_services_present" CHECK (cardinality("directory_listing"."services") > 0),
	CONSTRAINT "directory_listing_pin_code_format" CHECK ("directory_listing"."pin_code" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "directory_listing_public_contact_fields_known" CHECK ("directory_listing"."public_contact_fields" <@ array['phone', 'email', 'website']::text[]),
	CONSTRAINT "directory_listing_status_reason_length" CHECK (char_length("directory_listing"."status_reason") <= 1000),
	CONSTRAINT "directory_listing_verified_at_matches_status" CHECK ("directory_listing"."status" NOT IN ('verified', 'suspended') OR "directory_listing"."verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "directory_listing_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"kind" "directory_document_kind" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_listing" ADD CONSTRAINT "directory_listing_status_changed_by_user_id_user_id_fk" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_listing" ADD CONSTRAINT "directory_listing_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_listing_document" ADD CONSTRAINT "directory_listing_document_listing_id_directory_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."directory_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_listing_document" ADD CONSTRAINT "directory_listing_document_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_listing_slug_unique" ON "directory_listing" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_listing_one_open_per_owner" ON "directory_listing" USING btree ("owner_user_id") WHERE "directory_listing"."status" IN ('pending_verification', 'verified', 'suspended');--> statement-breakpoint
CREATE INDEX "directory_listing_status_created_idx" ON "directory_listing" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "directory_listing_owner_user_id_idx" ON "directory_listing" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "directory_listing_status_changed_by_idx" ON "directory_listing" USING btree ("status_changed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_listing_document_file_unique" ON "directory_listing_document" USING btree ("file_asset_id");--> statement-breakpoint
CREATE INDEX "directory_listing_document_listing_idx" ON "directory_listing_document" USING btree ("listing_id","created_at");