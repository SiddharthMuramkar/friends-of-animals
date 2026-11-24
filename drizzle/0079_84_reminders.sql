CREATE TYPE "public"."reminder_job_status" AS ENUM('scheduled', 'fired', 'cancelled', 'superseded');--> statement-breakpoint
CREATE TABLE "reminder_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reminder_name" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"offset_hours" integer NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"status" "reminder_job_status" DEFAULT 'scheduled' NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reminder_job_name_format" CHECK ("reminder_job"."reminder_name" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "reminder_job_offset_hours" CHECK ("reminder_job"."offset_hours" BETWEEN 1 AND 720),
	CONSTRAINT "reminder_job_fire_at" CHECK ("reminder_job"."fire_at" = "reminder_job"."deadline_at" - make_interval(hours => "reminder_job"."offset_hours")),
	CONSTRAINT "reminder_job_fired_stamped" CHECK (("reminder_job"."status" = 'fired') = ("reminder_job"."fired_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_job_planned_once" ON "reminder_job" USING btree ("reminder_name","subject_id","offset_hours","deadline_at") WHERE "reminder_job"."status" IN ('scheduled', 'fired');--> statement-breakpoint
CREATE INDEX "reminder_job_subject_idx" ON "reminder_job" USING btree ("reminder_name","subject_id");