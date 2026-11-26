CREATE TYPE "public"."survey_delivery_status" AS ENUM('queued', 'sent', 'skipped');--> statement-breakpoint
CREATE TABLE "survey" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "survey_competition_id_unique" UNIQUE("competition_id"),
	CONSTRAINT "survey_send_dates" CHECK (("survey"."sent_at" IS NULL) = ("survey"."closes_at" IS NULL) AND ("survey"."closes_at" IS NULL OR "survey"."closes_at" > "survey"."sent_at") AND ("survey"."closed_at" IS NULL OR "survey"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "survey_invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"survey_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "survey_delivery_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"answers" jsonb,
	"answered_at" timestamp with time zone,
	CONSTRAINT "survey_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "survey_person_once" UNIQUE("survey_id","user_id"),
	CONSTRAINT "survey_answer_stamp" CHECK (("survey_invitation"."answers" IS NULL) = ("survey_invitation"."answered_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "survey" ADD CONSTRAINT "survey_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_survey_id_survey_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."survey"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_invitation_user_idx" ON "survey_invitation" USING btree ("user_id");