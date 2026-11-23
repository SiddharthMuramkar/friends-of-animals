CREATE TYPE "public"."breach_notice_role" AS ENUM('principal', 'guardian', 'principal_and_guardian');--> statement-breakpoint
CREATE TYPE "public"."breach_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."breach_status" AS ENUM('open', 'contained', 'notified', 'closed');--> statement-breakpoint
CREATE TYPE "public"."breach_subject_type" AS ENUM('user', 'participant_profile');--> statement-breakpoint
CREATE TYPE "public"."breach_timeline_kind" AS ENUM('recorded', 'updated', 'contained', 'principals_notified', 'authority_notified', 'note', 'closed');--> statement-breakpoint
CREATE TYPE "public"."breach_unreachable_reason" AS ENUM('no_guardian', 'no_account');--> statement-breakpoint
CREATE TABLE "breach_fan_out" (
	"breach_id" uuid PRIMARY KEY NOT NULL,
	"after_user_id" uuid,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "breach_notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"breach_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"channel" "message_channel" NOT NULL,
	"recipient_role" "breach_notice_role" NOT NULL,
	"about_count" integer NOT NULL,
	"guardian_profile_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"suppressed_at" timestamp with time zone,
	CONSTRAINT "breach_notification_once" UNIQUE("breach_id","recipient_user_id","channel"),
	CONSTRAINT "breach_notification_about_someone" CHECK ("breach_notification"."about_count" >= 1),
	CONSTRAINT "breach_notification_one_outcome" CHECK ("breach_notification"."sent_at" IS NULL OR "breach_notification"."suppressed_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "breach_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title_ciphertext" text NOT NULL,
	"aware_at" timestamp with time zone NOT NULL,
	"severity" "breach_severity" NOT NULL,
	"personal_data_involved" boolean NOT NULL,
	"minors_affected" boolean NOT NULL,
	"affected_count" integer NOT NULL,
	"impact_ciphertext" text NOT NULL,
	"status" "breach_status" DEFAULT 'open' NOT NULL,
	"contained_at" timestamp with time zone,
	"principals_notified_at" timestamp with time zone,
	"authority_notified_at" timestamp with time zone,
	"authority_reference_ciphertext" text,
	"authority_email_queued_at" timestamp with time zone,
	"authority_email_sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"lead_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "breach_record_affected_count_not_negative" CHECK ("breach_record"."affected_count" >= 0),
	CONSTRAINT "breach_record_closed_has_closed_at" CHECK (("breach_record"."status" = 'closed') = ("breach_record"."closed_at" IS NOT NULL)),
	CONSTRAINT "breach_record_contained_has_contained_at" CHECK ("breach_record"."status" <> 'contained' OR "breach_record"."contained_at" IS NOT NULL),
	CONSTRAINT "breach_record_notified_has_a_notice" CHECK ("breach_record"."status" <> 'notified' OR "breach_record"."principals_notified_at" IS NOT NULL OR "breach_record"."authority_notified_at" IS NOT NULL),
	CONSTRAINT "breach_record_reference_after_notice" CHECK ("breach_record"."authority_reference_ciphertext" IS NULL OR "breach_record"."authority_notified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "breach_timeline_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"breach_id" uuid NOT NULL,
	"kind" "breach_timeline_kind" NOT NULL,
	"note_ciphertext" text,
	"author_user_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "breach_timeline_event_note_has_text" CHECK ("breach_timeline_event"."kind" <> 'note' OR "breach_timeline_event"."note_ciphertext" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "breach_unreachable" (
	"breach_id" uuid NOT NULL,
	"subject_type" "breach_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" "breach_unreachable_reason" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "breach_unreachable_pk" PRIMARY KEY("breach_id","subject_type","subject_id")
);
--> statement-breakpoint
ALTER TABLE "breach_fan_out" ADD CONSTRAINT "breach_fan_out_breach_id_breach_record_id_fk" FOREIGN KEY ("breach_id") REFERENCES "public"."breach_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notification" ADD CONSTRAINT "breach_notification_breach_id_breach_record_id_fk" FOREIGN KEY ("breach_id") REFERENCES "public"."breach_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_notification" ADD CONSTRAINT "breach_notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_record" ADD CONSTRAINT "breach_record_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_timeline_event" ADD CONSTRAINT "breach_timeline_event_breach_id_breach_record_id_fk" FOREIGN KEY ("breach_id") REFERENCES "public"."breach_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_unreachable" ADD CONSTRAINT "breach_unreachable_breach_id_breach_record_id_fk" FOREIGN KEY ("breach_id") REFERENCES "public"."breach_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breach_notification_recipient_user_id_idx" ON "breach_notification" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "breach_record_log_order_idx" ON "breach_record" USING btree (("status" <> 'closed') desc,"aware_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "breach_record_status_closed_at_idx" ON "breach_record" USING btree ("status","closed_at");--> statement-breakpoint
CREATE INDEX "breach_record_lead_user_id_idx" ON "breach_record" USING btree ("lead_user_id");--> statement-breakpoint
CREATE INDEX "breach_timeline_event_breach_id_idx" ON "breach_timeline_event" USING btree ("breach_id","occurred_at");