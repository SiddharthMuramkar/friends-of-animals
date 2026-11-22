CREATE TYPE "public"."incident_log_kind" AS ENUM('note', 'status_change', 'escalation');--> statement-breakpoint
CREATE TYPE "public"."safeguarding_report_status" AS ENUM('new', 'triaged', 'investigating', 'escalated', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."safeguarding_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'safeguarding_lead';--> statement-breakpoint
CREATE TABLE "safeguarding_incident_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" "incident_log_kind" NOT NULL,
	"to_status" "safeguarding_report_status",
	"severity" "safeguarding_severity",
	"body_ciphertext" text,
	"author_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safeguarding_incident_log_note_has_body" CHECK ("safeguarding_incident_log"."kind" <> 'note' OR "safeguarding_incident_log"."body_ciphertext" IS NOT NULL),
	CONSTRAINT "safeguarding_incident_log_move_has_status" CHECK (("safeguarding_incident_log"."kind" = 'note') = ("safeguarding_incident_log"."to_status" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "safeguarding_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"category" text NOT NULL,
	"description_ciphertext" text NOT NULL,
	"subject_details_ciphertext" text,
	"subject_age" smallint,
	"reporter_is_child" boolean NOT NULL,
	"anonymous" boolean NOT NULL,
	"reporter_name_ciphertext" text,
	"reporter_contact_ciphertext" text,
	"status" "safeguarding_report_status" DEFAULT 'new' NOT NULL,
	"severity" "safeguarding_severity",
	"assigned_to_user_id" uuid,
	"escalation_reference_ciphertext" text,
	"outcome_ciphertext" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "safeguarding_report_reference_unique" UNIQUE("reference"),
	CONSTRAINT "safeguarding_report_subject_age_range" CHECK ("safeguarding_report"."subject_age" BETWEEN 0 AND 17),
	CONSTRAINT "safeguarding_report_anonymous_has_no_reporter" CHECK (NOT "safeguarding_report"."anonymous" OR ("safeguarding_report"."reporter_name_ciphertext" IS NULL AND "safeguarding_report"."reporter_contact_ciphertext" IS NULL)),
	CONSTRAINT "safeguarding_report_severity_after_triage" CHECK (("safeguarding_report"."status" = 'new') = ("safeguarding_report"."severity" IS NULL)),
	CONSTRAINT "safeguarding_report_escalated_has_reference" CHECK ("safeguarding_report"."status" <> 'escalated' OR "safeguarding_report"."escalation_reference_ciphertext" IS NOT NULL),
	CONSTRAINT "safeguarding_report_resolved_has_outcome" CHECK (("safeguarding_report"."status" = 'resolved') = ("safeguarding_report"."outcome_ciphertext" IS NOT NULL AND "safeguarding_report"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "safeguarding_incident_log" ADD CONSTRAINT "safeguarding_incident_log_report_id_safeguarding_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."safeguarding_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safeguarding_report" ADD CONSTRAINT "safeguarding_report_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safeguarding_incident_log_report_id_idx" ON "safeguarding_incident_log" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "safeguarding_report_status_created_at_idx" ON "safeguarding_report" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "safeguarding_report_assigned_to_user_id_idx" ON "safeguarding_report" USING btree ("assigned_to_user_id");