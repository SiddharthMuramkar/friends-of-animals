CREATE TYPE "public"."campaign_recipient_status" AS ENUM('queued', 'sent', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'sending', 'sent');--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"segment" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"planned_counts" jsonb,
	"completed_at" timestamp with time zone,
	CONSTRAINT "campaign_sent_stamped" CHECK (("campaign"."status" = 'draft') = ("campaign"."sent_at" IS NULL) AND ("campaign"."sent_at" IS NULL) = ("campaign"."planned_counts" IS NULL)),
	CONSTRAINT "campaign_completed_when_sent" CHECK (("campaign"."status" = 'sent') = ("campaign"."completed_at" IS NOT NULL)),
	CONSTRAINT "campaign_revision_positive" CHECK ("campaign"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_recipient" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bases" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"status" "campaign_recipient_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "campaign_recipient_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "campaign_recipient_once" UNIQUE("campaign_id","user_id"),
	CONSTRAINT "campaign_recipient_settled_stamped" CHECK (("campaign_recipient"."status" = 'queued') = ("campaign_recipient"."settled_at" IS NULL)),
	CONSTRAINT "campaign_recipient_has_bases" CHECK (jsonb_array_length("campaign_recipient"."bases") > 0)
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_newest_idx" ON "campaign" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "campaign_created_by_idx" ON "campaign" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "campaign_sent_by_idx" ON "campaign" USING btree ("sent_by");--> statement-breakpoint
CREATE INDEX "campaign_recipient_campaign_status_idx" ON "campaign_recipient" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipient_user_id_idx" ON "campaign_recipient" USING btree ("user_id");