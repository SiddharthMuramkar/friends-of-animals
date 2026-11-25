CREATE TYPE "public"."entry_verification_decision" AS ENUM('verified', 'sent_back');--> statement-breakpoint
CREATE TABLE "entry_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"decision" "entry_verification_decision" NOT NULL,
	"reason_code" text,
	"reason_text" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"resubmission_due_at" timestamp with time zone,
	"resubmitted_at" timestamp with time zone,
	"resubmitted_by_user_id" uuid,
	"resubmission_with_file" boolean,
	CONSTRAINT "entry_verification_sent_back_has_deadline" CHECK (("entry_verification"."decision" = 'sent_back') = ("entry_verification"."resubmission_due_at" IS NOT NULL)),
	CONSTRAINT "entry_verification_sent_back_has_reason" CHECK (("entry_verification"."decision" = 'sent_back') = ("entry_verification"."reason_code" IS NOT NULL)),
	CONSTRAINT "entry_verification_reason_text_length" CHECK ("entry_verification"."reason_text" IS NULL OR char_length("entry_verification"."reason_text") BETWEEN 1 AND 500),
	CONSTRAINT "entry_verification_resubmission_complete" CHECK (("entry_verification"."resubmitted_at" IS NULL) = ("entry_verification"."resubmission_with_file" IS NULL) AND ("entry_verification"."resubmitted_at" IS NULL OR "entry_verification"."decision" = 'sent_back'))
);
--> statement-breakpoint
ALTER TABLE "entry_verification" ADD CONSTRAINT "entry_verification_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_verification" ADD CONSTRAINT "entry_verification_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_verification" ADD CONSTRAINT "entry_verification_resubmitted_by_user_id_user_id_fk" FOREIGN KEY ("resubmitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_verification_entry_id_decided_at_idx" ON "entry_verification" USING btree ("entry_id","decided_at");--> statement-breakpoint
CREATE INDEX "entry_verification_decided_by_user_id_idx" ON "entry_verification" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "entry_verification_resubmitted_by_user_id_idx" ON "entry_verification" USING btree ("resubmitted_by_user_id");