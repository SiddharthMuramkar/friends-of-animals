CREATE TYPE "public"."ambassador_application_status" AS ENUM('submitted', 'approved', 'declined');--> statement-breakpoint
CREATE TABLE "ambassador_application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"status" "ambassador_application_status" NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decline_reason_ciphertext" text,
	CONSTRAINT "ambassador_application_decision" CHECK (("ambassador_application"."status" = 'submitted' AND "ambassador_application"."decided_at" IS NULL AND "ambassador_application"."decided_by_user_id" IS NULL AND "ambassador_application"."decline_reason_ciphertext" IS NULL) OR ("ambassador_application"."status" = 'approved' AND "ambassador_application"."decided_at" IS NOT NULL AND "ambassador_application"."decline_reason_ciphertext" IS NULL) OR ("ambassador_application"."status" = 'declined' AND "ambassador_application"."decided_at" IS NOT NULL AND "ambassador_application"."decline_reason_ciphertext" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "ambassador_application" ADD CONSTRAINT "ambassador_application_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassador_application" ADD CONSTRAINT "ambassador_application_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ambassador_application_live_unique" ON "ambassador_application" USING btree ("applicant_user_id") WHERE "ambassador_application"."status" IN ('submitted','approved');--> statement-breakpoint
CREATE INDEX "ambassador_application_applicant_idx" ON "ambassador_application" USING btree ("applicant_user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "ambassador_application_decider_idx" ON "ambassador_application" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "ambassador_application_queue_idx" ON "ambassador_application" USING btree ("status","submitted_at");