CREATE TABLE "competition_cancellation_email" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "competition" DROP CONSTRAINT "competition_published_at_matches_status";--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "competition_cancellation_email" ADD CONSTRAINT "competition_cancellation_email_delivery_id_outbox_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_cancellation_complete" CHECK (("competition"."status" NOT IN ('draft', 'published', 'registration_open', 'registration_closed', 'school_judging')) = ("competition"."cancelled_at" IS NOT NULL)
        AND ("competition"."cancelled_at" IS NULL) = ("competition"."cancel_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_cancel_reason_present" CHECK ("competition"."cancel_reason" IS NULL OR length(trim("competition"."cancel_reason")) > 0);--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_published_at_matches_status" CHECK (("competition"."status" <> 'draft' OR "competition"."published_at" IS NULL) AND ("competition"."published_at" IS NOT NULL OR "competition"."status" = 'draft' OR "competition"."cancelled_at" IS NOT NULL));