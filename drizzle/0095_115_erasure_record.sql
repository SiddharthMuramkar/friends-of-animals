CREATE TABLE "erasure_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid,
	"subject_kind" "privacy_subject_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_ids" uuid[] NOT NULL,
	"profile_ids" uuid[] NOT NULL,
	"outcome" text NOT NULL,
	"categories" jsonb NOT NULL,
	"retained_until" timestamp with time zone,
	"erased_at" timestamp with time zone NOT NULL,
	CONSTRAINT "erasure_record_outcome" CHECK ("erasure_record"."outcome" IN ('completed', 'partially_completed'))
);
--> statement-breakpoint
ALTER TABLE "erasure_record" ADD CONSTRAINT "erasure_record_request_id_privacy_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erasure_record_request_idx" ON "erasure_record" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "erasure_record_subject_idx" ON "erasure_record" USING btree ("subject_kind","subject_id");