CREATE TYPE "public"."volunteer_hours_status" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."volunteer_task_status" AS ENUM('draft', 'open', 'assigned', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "volunteer_hours_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"worked_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"note_ciphertext" text,
	"status" "volunteer_hours_status" NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason_ciphertext" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "volunteer_hours_minutes_range" CHECK ("volunteer_hours_entry"."minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "volunteer_hours_decision_record" CHECK (("volunteer_hours_entry"."status" = 'submitted') = ("volunteer_hours_entry"."decided_at" IS NULL)),
	CONSTRAINT "volunteer_hours_reason_record" CHECK (("volunteer_hours_entry"."status" = 'rejected') = ("volunteer_hours_entry"."reject_reason_ciphertext" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "volunteer_task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title_ciphertext" text NOT NULL,
	"description_ciphertext" text NOT NULL,
	"status" "volunteer_task_status" NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_task_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"volunteer_user_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	"unassigned_at" timestamp with time zone,
	CONSTRAINT "volunteer_assignment_dates" CHECK ("volunteer_task_assignment"."unassigned_at" IS NULL OR "volunteer_task_assignment"."unassigned_at" >= "volunteer_task_assignment"."assigned_at")
);
--> statement-breakpoint
ALTER TABLE "volunteer_hours_entry" ADD CONSTRAINT "volunteer_hours_entry_assignment_id_volunteer_task_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."volunteer_task_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_hours_entry" ADD CONSTRAINT "volunteer_hours_entry_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_task" ADD CONSTRAINT "volunteer_task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_task_assignment" ADD CONSTRAINT "volunteer_task_assignment_task_id_volunteer_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."volunteer_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_task_assignment" ADD CONSTRAINT "volunteer_task_assignment_volunteer_user_id_user_id_fk" FOREIGN KEY ("volunteer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_task_assignment" ADD CONSTRAINT "volunteer_task_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "volunteer_hours_assignment_idx" ON "volunteer_hours_entry" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "volunteer_hours_status_idx" ON "volunteer_hours_entry" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "volunteer_hours_decider_idx" ON "volunteer_hours_entry" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "volunteer_task_status_idx" ON "volunteer_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "volunteer_task_creator_idx" ON "volunteer_task" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_task_one_active_assignment" ON "volunteer_task_assignment" USING btree ("task_id","volunteer_user_id") WHERE "volunteer_task_assignment"."unassigned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "volunteer_task_assignment_volunteer_idx" ON "volunteer_task_assignment" USING btree ("volunteer_user_id");--> statement-breakpoint
CREATE INDEX "volunteer_task_assignment_task_idx" ON "volunteer_task_assignment" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "volunteer_task_assignment_actor_idx" ON "volunteer_task_assignment" USING btree ("assigned_by_user_id");