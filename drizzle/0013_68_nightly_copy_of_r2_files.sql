CREATE TABLE "offsite_copy" (
	"source_bucket" text NOT NULL,
	"key" text NOT NULL,
	"etag" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"source_last_modified" timestamp with time zone NOT NULL,
	"copied_at" timestamp with time zone NOT NULL,
	"deleted_in_source_at" timestamp with time zone,
	CONSTRAINT "offsite_copy_source_bucket_key_pk" PRIMARY KEY("source_bucket","key"),
	CONSTRAINT "offsite_copy_size_bytes_not_negative" CHECK ("offsite_copy"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX "offsite_copy_deleted_in_source_idx" ON "offsite_copy" USING btree ("source_bucket","deleted_in_source_at") WHERE "offsite_copy"."deleted_in_source_at" IS NOT NULL;