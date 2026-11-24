CREATE TABLE "legal_hold" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by_user_id" uuid,
	"placed_at" timestamp with time zone NOT NULL,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	CONSTRAINT "legal_hold_subject_type_known" CHECK ("legal_hold"."subject_type" IN ('user', 'participant_profile', 'institution')),
	CONSTRAINT "legal_hold_reason_length" CHECK (char_length("legal_hold"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "legal_hold_released_by_only_when_released" CHECK ("legal_hold"."released_by_user_id" IS NULL OR "legal_hold"."released_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "retention_run_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_process" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"policies" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_asset" ADD COLUMN "quarantine_purge_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_hold" ADD CONSTRAINT "legal_hold_placed_by_user_id_user_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_hold" ADD CONSTRAINT "legal_hold_released_by_user_id_user_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_hold_one_active_per_subject" ON "legal_hold" USING btree ("subject_type","subject_id") WHERE "legal_hold"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "legal_hold_active_idx" ON "legal_hold" USING btree ("subject_type") WHERE "legal_hold"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "legal_hold_active_placed_at_idx" ON "legal_hold" USING btree ("placed_at","id") WHERE "legal_hold"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "legal_hold_placed_by_user_id_idx" ON "legal_hold" USING btree ("placed_by_user_id");--> statement-breakpoint
CREATE INDEX "legal_hold_released_by_user_id_idx" ON "legal_hold" USING btree ("released_by_user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_id_idx" ON "session" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "verification_expires_at_id_idx" ON "verification" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "captured_message_created_at_id_idx" ON "captured_message" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "outbox_dispatched_at_idx" ON "outbox" USING btree ("dispatched_at","id") WHERE "outbox"."dispatched_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_quarantine_purge_status" CHECK (NOT "file_asset"."quarantine_purge_pending" OR "file_asset"."status" = 'quarantined');