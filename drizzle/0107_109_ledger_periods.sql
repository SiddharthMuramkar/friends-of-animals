CREATE TYPE "public"."finance_approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ledger_period_status" AS ENUM('open', 'locked');--> statement-breakpoint
CREATE TABLE "finance_approval" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "finance_approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"executed_posting_id" uuid,
	CONSTRAINT "finance_approval_operation_format" CHECK ("finance_approval"."operation" ~ '^[a-z][a-z_]{0,39}$'),
	CONSTRAINT "finance_approval_expires_after_request" CHECK ("finance_approval"."expires_at" > "finance_approval"."requested_at"),
	CONSTRAINT "finance_approval_decision_matches_status" CHECK (CASE "finance_approval"."status"
        WHEN 'pending' THEN "finance_approval"."decided_at" IS NULL AND "finance_approval"."decided_by_user_id" IS NULL
        WHEN 'approved' THEN "finance_approval"."decided_at" IS NOT NULL AND "finance_approval"."decided_by_user_id" IS NOT NULL AND "finance_approval"."decided_by_user_id" <> "finance_approval"."requested_by_user_id"
        WHEN 'rejected' THEN "finance_approval"."decided_at" IS NOT NULL AND "finance_approval"."decided_by_user_id" IS NOT NULL AND "finance_approval"."decided_by_user_id" <> "finance_approval"."requested_by_user_id"
        WHEN 'cancelled' THEN "finance_approval"."decided_at" IS NOT NULL AND "finance_approval"."decided_by_user_id" = "finance_approval"."requested_by_user_id"
        WHEN 'expired' THEN "finance_approval"."decided_at" IS NOT NULL AND "finance_approval"."decided_by_user_id" IS NULL
      END),
	CONSTRAINT "finance_approval_reason_only_when_rejected" CHECK (("finance_approval"."status" = 'rejected') = ("finance_approval"."decision_reason" IS NOT NULL AND btrim("finance_approval"."decision_reason") <> '')),
	CONSTRAINT "finance_approval_reason_length" CHECK (char_length("finance_approval"."decision_reason") <= 500),
	CONSTRAINT "finance_approval_posting_only_when_approved" CHECK ("finance_approval"."executed_posting_id" IS NULL OR "finance_approval"."status" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "ledger_period" (
	"month" text PRIMARY KEY NOT NULL,
	"status" "ledger_period_status" DEFAULT 'open' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"last_unlocked_at" timestamp with time zone,
	"last_unlocked_by_user_id" uuid,
	"last_unlock_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_period_month_format" CHECK ("ledger_period"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ledger_period_locked_fields_match_status" CHECK (("ledger_period"."status" = 'locked') = ("ledger_period"."locked_at" IS NOT NULL AND "ledger_period"."locked_by_user_id" IS NOT NULL)),
	CONSTRAINT "ledger_period_unlock_fields_together" CHECK (("ledger_period"."last_unlocked_at" IS NULL) = ("ledger_period"."last_unlocked_by_user_id" IS NULL) AND ("ledger_period"."last_unlocked_at" IS NULL) = ("ledger_period"."last_unlock_reason" IS NULL)),
	CONSTRAINT "ledger_period_unlock_reason_length" CHECK (char_length("ledger_period"."last_unlock_reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX "finance_approval_pending_requested_at_idx" ON "finance_approval" USING btree ("requested_at") WHERE "finance_approval"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "finance_approval_executed_posting_id_idx" ON "finance_approval" USING btree ("executed_posting_id");