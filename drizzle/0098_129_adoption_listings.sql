CREATE TYPE "public"."adoption_listing_status" AS ENUM('draft', 'published', 'on_hold', 'adopted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."adoption_species" AS ENUM('dog', 'cat', 'rabbit', 'bird', 'other');--> statement-breakpoint
CREATE TYPE "public"."animal_sex" AS ENUM('female', 'male', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."animal_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "adoption_listing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"directory_listing_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"species" "adoption_species" NOT NULL,
	"breed" text,
	"sex" "animal_sex" NOT NULL,
	"size" "animal_size",
	"colour" text,
	"birth_month" date NOT NULL,
	"sterilised" boolean,
	"about" text,
	"health_notes" text,
	"vaccination_notes" text,
	"conditions" text NOT NULL,
	"state" text NOT NULL,
	"city" text NOT NULL,
	"city_key" text NOT NULL,
	"pin_code" text NOT NULL,
	"status" "adoption_listing_status" NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "adoption_listing_pin_code_format" CHECK ("adoption_listing"."pin_code" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "adoption_listing_birth_month_first" CHECK (extract(day from "adoption_listing"."birth_month") = 1),
	CONSTRAINT "adoption_listing_published_at_matches_status" CHECK ("adoption_listing"."status" NOT IN ('published', 'on_hold', 'adopted') OR "adoption_listing"."published_at" IS NOT NULL),
	CONSTRAINT "adoption_listing_closed_at_matches_status" CHECK (("adoption_listing"."status" IN ('adopted', 'withdrawn')) = ("adoption_listing"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "adoption_listing_photo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"file_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"alt_text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "adoption_listing_photo_position_positive" CHECK ("adoption_listing_photo"."position" > 0)
);
--> statement-breakpoint
ALTER TABLE "adoption_listing" ADD CONSTRAINT "adoption_listing_directory_listing_id_directory_listing_id_fk" FOREIGN KEY ("directory_listing_id") REFERENCES "public"."directory_listing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_listing" ADD CONSTRAINT "adoption_listing_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_listing_photo" ADD CONSTRAINT "adoption_listing_photo_listing_id_adoption_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."adoption_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoption_listing_photo" ADD CONSTRAINT "adoption_listing_photo_file_asset_id_file_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."file_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_listing_slug_unique" ON "adoption_listing" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "adoption_listing_status_published_idx" ON "adoption_listing" USING btree ("status","published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "adoption_listing_directory_listing_idx" ON "adoption_listing" USING btree ("directory_listing_id","created_at");--> statement-breakpoint
CREATE INDEX "adoption_listing_created_by_idx" ON "adoption_listing" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "adoption_listing_photo_file_unique" ON "adoption_listing_photo" USING btree ("file_asset_id");--> statement-breakpoint
CREATE INDEX "adoption_listing_photo_listing_idx" ON "adoption_listing_photo" USING btree ("listing_id","position");