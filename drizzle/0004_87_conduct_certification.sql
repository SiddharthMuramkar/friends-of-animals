CREATE TABLE "conduct_certification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_registration_id" uuid NOT NULL,
	"certified_by_user_id" uuid,
	"certified_at" timestamp with time zone NOT NULL,
	"statement_version" text NOT NULL,
	CONSTRAINT "conduct_certification_institution_registration_id_unique" UNIQUE("institution_registration_id")
);
--> statement-breakpoint
ALTER TABLE "conduct_certification" ADD CONSTRAINT "conduct_certification_certified_by_user_id_user_id_fk" FOREIGN KEY ("certified_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conduct_certification_certified_by_user_id_idx" ON "conduct_certification" USING btree ("certified_by_user_id");