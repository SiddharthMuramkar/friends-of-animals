CREATE TYPE "public"."file_asset_purpose" AS ENUM('test_upload');--> statement-breakpoint
CREATE TYPE "public"."file_asset_status" AS ENUM('pending_upload', 'uploaded', 'scanning', 'clean', 'quarantined', 'rejected', 'deleted');--> statement-breakpoint
CREATE TABLE "file_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" "file_asset_purpose" NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" "file_asset_status" DEFAULT 'pending_upload' NOT NULL,
	"sha256" text,
	"scan_result" text,
	"scanned_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_asset_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "file_asset_size_bytes_positive" CHECK ("file_asset"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_asset_owner_created_idx" ON "file_asset" USING btree ("owner_user_id","created_at" DESC NULLS LAST);