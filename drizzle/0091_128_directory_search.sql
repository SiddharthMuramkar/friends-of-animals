CREATE TABLE "pincode_location" (
	"pin_code" text PRIMARY KEY NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"district" text,
	"state" text,
	"post_offices" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pincode_location_pin_code_format" CHECK ("pincode_location"."pin_code" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "pincode_location_coordinates_range" CHECK ("pincode_location"."latitude" BETWEEN -90 AND 90 AND "pincode_location"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE INDEX "pincode_location_latitude_idx" ON "pincode_location" USING btree ("latitude");--> statement-breakpoint
CREATE INDEX "directory_listing_services_idx" ON "directory_listing" USING gin ("services");