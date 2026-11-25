CREATE TYPE "public"."certificate_archive_status" AS ENUM('pending', 'ready', 'failed', 'invalidated');--> statement-breakpoint
CREATE TABLE "certificate_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_registration_id" uuid NOT NULL,
	"status" "certificate_archive_status" DEFAULT 'pending' NOT NULL,
	"certificate_ids" uuid[] NOT NULL,
	"profile_ids" uuid[] NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "certificate_archive_manifest_nonempty" CHECK (cardinality("certificate_archive"."certificate_ids") > 0 AND cardinality("certificate_archive"."profile_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "certificate_archive" ADD CONSTRAINT "certificate_archive_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_archive_registration_idx" ON "certificate_archive" USING btree ("institution_registration_id","created_at");