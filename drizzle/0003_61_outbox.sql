CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'dispatched', 'failed');--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "outbox_event_id_handler_key" UNIQUE("event_id","handler"),
	CONSTRAINT "outbox_attempts_not_negative" CHECK ("outbox"."attempts" >= 0),
	CONSTRAINT "outbox_dispatched_at_when_dispatched" CHECK (("outbox"."status" = 'dispatched') = ("outbox"."dispatched_at" IS NOT NULL)),
	CONSTRAINT "outbox_failed_at_when_failed" CHECK (("outbox"."status" = 'failed') = ("outbox"."failed_at" IS NOT NULL AND "outbox"."last_error" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "outbox_pending_available_at_idx" ON "outbox" USING btree ("available_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox" USING btree ("aggregate_type","aggregate_id");