CREATE TYPE "public"."file_processing_status" AS ENUM('queued', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "file_derivative" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_derivative_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "file_derivative_file_asset_id_kind_key" UNIQUE("file_asset_id","kind"),
	CONSTRAINT "file_derivative_size_bytes_positive" CHECK ("file_derivative"."size_bytes" > 0),
	CONSTRAINT "file_derivative_size_positive" CHECK (("file_derivative"."width" IS NULL OR "file_derivative"."width" > 0) AND ("file_derivative"."height" IS NULL OR "file_derivative"."height" > 0))
);
--> statement-breakpoint
CREATE TABLE "file_processing" (
	"file_asset_id" uuid PRIMARY KEY NOT NULL,
	"status" "file_processing_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_processing_attempts_not_negative" CHECK ("file_processing"."attempts" >= 0),
	CONSTRAINT "file_processing_error_code_when_failed" CHECK (("file_processing"."status" = 'failed') = ("file_processing"."error_code" IS NOT NULL)),
	CONSTRAINT "file_processing_finished_at_when_finished" CHECK (("file_processing"."status" = 'queued') = ("file_processing"."finished_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "file_derivative" ADD CONSTRAINT "file_derivative_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_processing" ADD CONSTRAINT "file_processing_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE restrict ON UPDATE no action;