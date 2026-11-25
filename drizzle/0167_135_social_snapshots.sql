CREATE TYPE "public"."social_metric_channel" AS ENUM('instagram', 'facebook', 'youtube', 'x', 'linkedin', 'other');--> statement-breakpoint
CREATE TABLE "social_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" "social_metric_channel" NOT NULL,
	"recorded_for" date NOT NULL,
	"followers" integer NOT NULL,
	"posts" integer NOT NULL,
	"reach" integer,
	"impressions" integer,
	"engagements" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "social_snapshot_channel_date_unique" UNIQUE("channel","recorded_for"),
	CONSTRAINT "social_snapshot_nonnegative" CHECK ("social_snapshot"."followers" >= 0 AND "social_snapshot"."posts" >= 0 AND ("social_snapshot"."reach" IS NULL OR "social_snapshot"."reach" >= 0) AND ("social_snapshot"."impressions" IS NULL OR "social_snapshot"."impressions" >= 0) AND ("social_snapshot"."engagements" IS NULL OR "social_snapshot"."engagements" >= 0))
);
