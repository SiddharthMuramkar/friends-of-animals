CREATE TYPE "public"."rubric_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."competition_status" ADD VALUE 'school_judging';--> statement-breakpoint
CREATE TABLE "rubric" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"discipline" "competition_discipline" NOT NULL,
	"version" integer NOT NULL,
	"status" "rubric_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "rubric_version_unique" UNIQUE("competition_id","discipline","version"),
	CONSTRAINT "rubric_version_positive" CHECK ("rubric"."version" >= 1),
	CONSTRAINT "rubric_published_at_matches_status" CHECK (("rubric"."status" = 'draft') = ("rubric"."published_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "rubric_criterion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rubric_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"weight" integer NOT NULL,
	"min_score" integer NOT NULL,
	"max_score" integer NOT NULL,
	CONSTRAINT "rubric_criterion_position_unique" UNIQUE("rubric_id","position"),
	CONSTRAINT "rubric_criterion_position" CHECK ("rubric_criterion"."position" >= 0),
	CONSTRAINT "rubric_criterion_label" CHECK (char_length("rubric_criterion"."label") BETWEEN 1 AND 120),
	CONSTRAINT "rubric_criterion_description" CHECK (char_length("rubric_criterion"."description") <= 600),
	CONSTRAINT "rubric_criterion_weight" CHECK ("rubric_criterion"."weight" BETWEEN 1 AND 100),
	CONSTRAINT "rubric_criterion_scores" CHECK ("rubric_criterion"."min_score" >= 0 AND "rubric_criterion"."max_score" <= 100 AND "rubric_criterion"."min_score" < "rubric_criterion"."max_score")
);
--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_one_draft_per_discipline" ON "rubric" USING btree ("competition_id","discipline") WHERE "rubric"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_one_published_per_discipline" ON "rubric" USING btree ("competition_id","discipline") WHERE "rubric"."status" = 'published';--> statement-breakpoint
CREATE INDEX "rubric_created_by_user_id_idx" ON "rubric" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "rubric_published_by_user_id_idx" ON "rubric" USING btree ("published_by_user_id");