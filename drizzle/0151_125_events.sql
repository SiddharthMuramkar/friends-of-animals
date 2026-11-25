CREATE TYPE "public"."event_audience" AS ENUM('members', 'signed_in');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('event', 'campaign');--> statement-breakpoint
CREATE TYPE "public"."event_registration_status" AS ENUM('registered', 'waitlisted', 'cancelled', 'checked_in', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'cancelled', 'completed');--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" "event_kind" NOT NULL,
	"status" "event_status" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"venue_name" text,
	"address" text,
	"city" text,
	"pin_code" text,
	"online_url" text,
	"capacity" integer,
	"audience" "event_audience" NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"waitlist_enabled" boolean NOT NULL,
	"created_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_slug_unique" UNIQUE("slug"),
	CONSTRAINT "event_time_order" CHECK ("event"."ends_at" > "event"."starts_at"),
	CONSTRAINT "event_capacity_positive" CHECK ("event"."capacity" IS NULL OR "event"."capacity" > 0),
	CONSTRAINT "event_registration_window" CHECK (("event"."registration_opens_at" IS NULL OR "event"."registration_opens_at" < coalesce("event"."registration_closes_at", "event"."starts_at")) AND ("event"."registration_closes_at" IS NULL OR "event"."registration_closes_at" <= "event"."ends_at")),
	CONSTRAINT "event_publication_stamped" CHECK ("event"."status" NOT IN ('published','completed') OR "event"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "event_registration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"subject_profile_id" uuid,
	"registered_by_user_id" uuid,
	"checked_in_by_user_id" uuid,
	"status" "event_registration_status" NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"waitlisted_at" timestamp with time zone,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_registration_one_subject" CHECK (num_nonnulls("event_registration"."subject_user_id", "event_registration"."subject_profile_id") = 1),
	CONSTRAINT "event_registration_waitlist_stamped" CHECK ("event_registration"."status" <> 'waitlisted' OR "event_registration"."waitlisted_at" IS NOT NULL),
	CONSTRAINT "event_registration_checkin_stamped" CHECK (("event_registration"."status" = 'checked_in') = ("event_registration"."checked_in_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_subject_profile_id_participant_profile_id_fk" FOREIGN KEY ("subject_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_registered_by_user_id_user_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_checked_in_by_user_id_user_id_fk" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_status_start_idx" ON "event" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "event_creator_idx" ON "event" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registration_unique_user" ON "event_registration" USING btree ("event_id","subject_user_id") WHERE "event_registration"."status" <> 'cancelled' AND "event_registration"."subject_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "event_registration_unique_profile" ON "event_registration" USING btree ("event_id","subject_profile_id") WHERE "event_registration"."status" <> 'cancelled' AND "event_registration"."subject_profile_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "event_registration_queue_idx" ON "event_registration" USING btree ("event_id","status","waitlisted_at","id");--> statement-breakpoint
CREATE INDEX "event_registration_user_idx" ON "event_registration" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "event_registration_profile_idx" ON "event_registration" USING btree ("subject_profile_id");--> statement-breakpoint
CREATE INDEX "event_registration_booker_idx" ON "event_registration" USING btree ("registered_by_user_id");--> statement-breakpoint
CREATE INDEX "event_registration_checker_idx" ON "event_registration" USING btree ("checked_in_by_user_id");