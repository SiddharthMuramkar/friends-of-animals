CREATE TYPE "public"."institution_registration_status" AS ENUM('active');--> statement-breakpoint
CREATE TABLE "institution_registration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "institution_registration_status" DEFAULT 'active' NOT NULL,
	"registered_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "institution_registration_institution_competition_unique" UNIQUE("institution_id","competition_id"),
	CONSTRAINT "institution_registration_reference_unique" UNIQUE("reference"),
	CONSTRAINT "institution_registration_reference_format" CHECK ("institution_registration"."reference" ~ '^[A-Z]{3,6}[0-9]{2}-I-[0-9A-HJKMNP-TV-Z]{5}$')
);
--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_registration" ADD CONSTRAINT "institution_registration_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "institution_registration_competition_id_idx" ON "institution_registration" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "institution_registration_registered_by_idx" ON "institution_registration" USING btree ("registered_by");