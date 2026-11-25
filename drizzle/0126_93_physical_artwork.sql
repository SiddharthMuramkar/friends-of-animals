CREATE TYPE "public"."physical_artwork_status" AS ENUM('requested', 'dispatched', 'received', 'discrepancy', 'verified', 'on_exhibition', 'retained', 'returned');--> statement-breakpoint
CREATE TABLE "physical_artwork" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"artwork_code" text NOT NULL,
	"status" "physical_artwork_status" NOT NULL,
	"institution_registration_id" uuid,
	"registration_id" uuid NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"dispatch_deadline" timestamp with time zone NOT NULL,
	"packaging_instructions" text NOT NULL,
	"shipping_payer" text NOT NULL,
	"facility_address" text NOT NULL,
	"courier_name" text,
	"tracking_number" text,
	"dispatched_by" uuid,
	"dispatched_at" timestamp with time zone,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	CONSTRAINT "physical_artwork_entry_id_key" UNIQUE("entry_id"),
	CONSTRAINT "physical_artwork_artwork_code_key" UNIQUE("artwork_code"),
	CONSTRAINT "physical_artwork_code_format" CHECK ("physical_artwork"."artwork_code" ~ '^[A-Z]{3,6}[0-9]{2}-A-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "physical_artwork_shipping_payer" CHECK ("physical_artwork"."shipping_payer" IN ('foa', 'sender')),
	CONSTRAINT "physical_artwork_dispatch_recorded_together" CHECK (("physical_artwork"."courier_name" IS NULL) = ("physical_artwork"."dispatched_at" IS NULL) AND ("physical_artwork"."tracking_number" IS NULL) = ("physical_artwork"."dispatched_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_institution_registration_id_institution_registration_id_fk" FOREIGN KEY ("institution_registration_id") REFERENCES "public"."institution_registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_dispatched_by_user_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_artwork" ADD CONSTRAINT "physical_artwork_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "physical_artwork_competition_status_idx" ON "physical_artwork" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "physical_artwork_tracking_number_idx" ON "physical_artwork" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "physical_artwork_institution_registration_id_idx" ON "physical_artwork" USING btree ("institution_registration_id");--> statement-breakpoint
CREATE INDEX "physical_artwork_registration_id_idx" ON "physical_artwork" USING btree ("registration_id");