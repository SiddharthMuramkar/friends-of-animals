CREATE TYPE "public"."artwork_condition" AS ENUM('excellent', 'good', 'fair', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."artwork_custody_kind" AS ENUM('received', 'stored', 'exhibited', 'moved', 'retained', 'returned');--> statement-breakpoint
CREATE TYPE "public"."artwork_photo_kind" AS ENUM('front', 'back', 'detail');--> statement-breakpoint
CREATE TABLE "artwork_custody_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artwork_id" uuid NOT NULL,
	"kind" "artwork_custody_kind" NOT NULL,
	"location" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"return_via" jsonb
);
--> statement-breakpoint
CREATE TABLE "artwork_discrepancy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artwork_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"notes" text NOT NULL,
	"raised_by" uuid,
	"raised_at" timestamp with time zone NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "artwork_discrepancy_resolution" CHECK (("artwork_discrepancy"."resolved_at" IS NULL) = ("artwork_discrepancy"."resolution" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "artwork_photo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artwork_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"kind" "artwork_photo_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"selected_at" timestamp with time zone,
	CONSTRAINT "artwork_photo_file_asset_id_unique" UNIQUE("file_asset_id")
);
--> statement-breakpoint
CREATE TABLE "artwork_results_window" (
	"competition_id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"results_published_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artwork_results_window_order" CHECK ("artwork_results_window"."closes_at" > "artwork_results_window"."results_published_at")
);
--> statement-breakpoint
CREATE TABLE "artwork_return_request" (
	"artwork_id" uuid PRIMARY KEY NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"via" jsonb,
	CONSTRAINT "artwork_return_request_fulfilment" CHECK (("artwork_return_request"."fulfilled_at" IS NULL) = ("artwork_return_request"."via" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "artwork_verification" (
	"artwork_id" uuid PRIMARY KEY NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone NOT NULL,
	"code_matches_label" boolean NOT NULL,
	"creator_confirmed" boolean NOT NULL,
	"matches_digital" boolean NOT NULL,
	"consent_documents_ok" boolean NOT NULL,
	"condition" "artwork_condition" NOT NULL,
	"condition_notes" text,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"depth_mm" integer,
	"material" text NOT NULL,
	CONSTRAINT "artwork_verification_dimensions" CHECK ("artwork_verification"."width_mm" BETWEEN 1 AND 10000 AND "artwork_verification"."height_mm" BETWEEN 1 AND 10000 AND ("artwork_verification"."depth_mm" IS NULL OR "artwork_verification"."depth_mm" BETWEEN 1 AND 10000)),
	CONSTRAINT "artwork_verification_passed" CHECK ("artwork_verification"."code_matches_label" AND "artwork_verification"."creator_confirmed" AND "artwork_verification"."matches_digital" AND "artwork_verification"."consent_documents_ok")
);
--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD COLUMN "storage_location" text;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD COLUMN "retained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artwork_custody_event" ADD CONSTRAINT "artwork_custody_event_artwork_id_physical_artwork_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."physical_artwork"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_discrepancy" ADD CONSTRAINT "artwork_discrepancy_artwork_id_physical_artwork_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."physical_artwork"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_discrepancy" ADD CONSTRAINT "artwork_discrepancy_raised_by_user_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_discrepancy" ADD CONSTRAINT "artwork_discrepancy_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_photo" ADD CONSTRAINT "artwork_photo_artwork_id_physical_artwork_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."physical_artwork"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_photo" ADD CONSTRAINT "artwork_photo_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_photo" ADD CONSTRAINT "artwork_photo_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_results_window" ADD CONSTRAINT "artwork_results_window_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_return_request" ADD CONSTRAINT "artwork_return_request_artwork_id_physical_artwork_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."physical_artwork"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_return_request" ADD CONSTRAINT "artwork_return_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_verification" ADD CONSTRAINT "artwork_verification_artwork_id_physical_artwork_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."physical_artwork"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_verification" ADD CONSTRAINT "artwork_verification_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artwork_custody_event_artwork_idx" ON "artwork_custody_event" USING btree ("artwork_id","at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_discrepancy_one_open" ON "artwork_discrepancy" USING btree ("artwork_id") WHERE "artwork_discrepancy"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "artwork_photo_artwork_idx" ON "artwork_photo" USING btree ("artwork_id");