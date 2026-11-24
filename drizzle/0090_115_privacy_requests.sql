CREATE TYPE "public"."privacy_request_relation" AS ENUM('self', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('submitted', 'in_progress', 'completed', 'partially_completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('access', 'correction', 'erasure');--> statement-breakpoint
CREATE TYPE "public"."privacy_subject_kind" AS ENUM('user', 'participant_profile');--> statement-breakpoint
CREATE TABLE "privacy_overdue_digest" (
	"day" text PRIMARY KEY NOT NULL,
	"overdue" integer NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"type" "privacy_request_type" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'submitted' NOT NULL,
	"relation" "privacy_request_relation" NOT NULL,
	"subject_kind" "privacy_subject_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"correction_details_ciphertext" text,
	"assigned_to_user_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"rejection_reason_ciphertext" text,
	"resolution_ciphertext" text,
	"export_requested_at" timestamp with time zone,
	"export_storage_key" text,
	"export_ready_at" timestamp with time zone,
	"export_expires_at" timestamp with time zone,
	"export_deleted_at" timestamp with time zone,
	"erasure_fingerprint" text,
	"erasure_approved_by_user_id" uuid,
	"erasure_approved_at" timestamp with time zone,
	"erasure_failure" text,
	"retained" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "privacy_request_reference_format" CHECK ("privacy_request"."reference" ~ '^PR-[0-9]{2}-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "privacy_request_correction_details" CHECK (("privacy_request"."type" = 'correction') = ("privacy_request"."correction_details_ciphertext" IS NOT NULL)),
	CONSTRAINT "privacy_request_guardian_subject" CHECK ("privacy_request"."relation" <> 'guardian' OR "privacy_request"."subject_kind" = 'participant_profile'),
	CONSTRAINT "privacy_request_closed_at" CHECK (("privacy_request"."status" IN ('submitted', 'in_progress')) = ("privacy_request"."closed_at" IS NULL)),
	CONSTRAINT "privacy_request_rejection_reason" CHECK (("privacy_request"."status" = 'rejected') = ("privacy_request"."rejection_reason_ciphertext" IS NOT NULL)),
	CONSTRAINT "privacy_request_partial_is_erasure" CHECK ("privacy_request"."status" <> 'partially_completed' OR "privacy_request"."type" = 'erasure'),
	CONSTRAINT "privacy_request_export_is_access" CHECK ("privacy_request"."export_requested_at" IS NULL OR "privacy_request"."type" = 'access'),
	CONSTRAINT "privacy_request_export_ready" CHECK (("privacy_request"."export_ready_at" IS NULL) = ("privacy_request"."export_storage_key" IS NULL) AND ("privacy_request"."export_ready_at" IS NULL) = ("privacy_request"."export_expires_at" IS NULL)),
	CONSTRAINT "privacy_request_erasure_approval" CHECK (("privacy_request"."erasure_fingerprint" IS NULL OR "privacy_request"."type" = 'erasure') AND ("privacy_request"."erasure_fingerprint" IS NULL) = ("privacy_request"."erasure_approved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "privacy_request_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_request" ADD CONSTRAINT "privacy_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request" ADD CONSTRAINT "privacy_request_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request" ADD CONSTRAINT "privacy_request_erasure_approved_by_user_id_user_id_fk" FOREIGN KEY ("erasure_approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_note" ADD CONSTRAINT "privacy_request_note_request_id_privacy_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_note" ADD CONSTRAINT "privacy_request_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_request_reference_unique" ON "privacy_request" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "privacy_request_status_due_idx" ON "privacy_request" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_request_requested_by_idx" ON "privacy_request" USING btree ("requested_by_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "privacy_request_subject_idx" ON "privacy_request" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "privacy_request_assigned_to_idx" ON "privacy_request" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "privacy_request_erasure_approved_by_idx" ON "privacy_request" USING btree ("erasure_approved_by_user_id");--> statement-breakpoint
CREATE INDEX "privacy_request_note_request_idx" ON "privacy_request_note" USING btree ("request_id","id");--> statement-breakpoint
CREATE INDEX "privacy_request_note_author_idx" ON "privacy_request_note" USING btree ("author_user_id");