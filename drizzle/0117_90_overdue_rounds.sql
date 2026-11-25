CREATE TYPE "public"."school_round_outcome" AS ENUM('shortlisted', 'not_shortlisted');--> statement-breakpoint
CREATE TABLE "school_round_family_notice" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"outcome" "school_round_outcome" NOT NULL,
	"position" integer,
	"told_at" timestamp with time zone NOT NULL,
	CONSTRAINT "school_round_family_notice_position_shortlisted" CHECK ("school_round_family_notice"."position" IS NULL OR ("school_round_family_notice"."outcome" = 'shortlisted' AND "school_round_family_notice"."position" >= 1))
);
--> statement-breakpoint
ALTER TABLE "competition" DROP CONSTRAINT "competition_cancellation_complete";--> statement-breakpoint
ALTER TABLE "school_round_pick" DROP CONSTRAINT "school_round_pick_entry_id_entry_id_fk";
--> statement-breakpoint
ALTER TABLE "school_round" ADD COLUMN "closed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "school_round" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_round" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "school_round_family_notice" ADD CONSTRAINT "school_round_family_notice_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_family_notice" ADD CONSTRAINT "school_round_family_notice_round_id_school_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."school_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_round_family_notice_round_id_idx" ON "school_round_family_notice" USING btree ("round_id");--> statement-breakpoint
ALTER TABLE "school_round" ADD CONSTRAINT "school_round_closed_by_user_id_user_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_pick" ADD CONSTRAINT "school_round_pick_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_round_closed_by_user_id_idx" ON "school_round" USING btree ("closed_by_user_id");--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_cancellation_complete" CHECK (("competition"."status"::text = 'cancelled') = ("competition"."cancelled_at" IS NOT NULL)
        AND ("competition"."cancelled_at" IS NULL) = ("competition"."cancel_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "school_round" ADD CONSTRAINT "school_round_close_reason_present" CHECK ("school_round"."close_reason" IS NULL OR length(trim("school_round"."close_reason")) > 0);