CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."message_delivery_status" AS ENUM('pending', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."message_suppression_reason" AS ENUM('preference_off', 'consent_withdrawn', 'sms_disabled', 'sms_unregistered', 'no_contact');--> statement-breakpoint
CREATE TABLE "inbox_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid,
	"template_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "inbox_item_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "message_delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer,
	"user_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"status" "message_delivery_status" NOT NULL,
	"reason" "message_suppression_reason",
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_delivery_once" UNIQUE("event_id","template_key","user_id","channel"),
	CONSTRAINT "message_delivery_reason_iff_suppressed" CHECK (("message_delivery"."status" = 'suppressed') = ("message_delivery"."reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "message_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"audience" text NOT NULL,
	"template_key" text NOT NULL,
	"channels" "message_channel"[] NOT NULL,
	"required_by_law" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_route_event_audience_template_unique" UNIQUE("event_type","audience","template_key"),
	CONSTRAINT "message_route_has_channels" CHECK (cardinality("message_route"."channels") > 0)
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" jsonb NOT NULL,
	"dlt_template_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_template_key_channel_locale_unique" UNIQUE("key","channel","locale"),
	CONSTRAINT "message_template_version_positive" CHECK ("message_template"."version" > 0),
	CONSTRAINT "message_template_sms_no_subject" CHECK ("message_template"."channel" <> 'sms' OR "message_template"."subject" IS NULL),
	CONSTRAINT "message_template_dlt_sms_only" CHECK ("message_template"."channel" = 'sms' OR "message_template"."dlt_template_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" boolean NOT NULL,
	"sms" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_delivery_id_message_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."message_delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery" ADD CONSTRAINT "message_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_item_user_newest_idx" ON "inbox_item" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inbox_item_unread_idx" ON "inbox_item" USING btree ("user_id") WHERE "inbox_item"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "message_delivery_user_idx" ON "message_delivery" USING btree ("user_id");