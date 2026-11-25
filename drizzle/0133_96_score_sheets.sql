CREATE TABLE "criterion_score" (
	"score_sheet_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"value" smallint,
	"changed_at_version" integer NOT NULL,
	CONSTRAINT "criterion_score_score_sheet_id_criterion_id_pk" PRIMARY KEY("score_sheet_id","criterion_id"),
	CONSTRAINT "criterion_score_range" CHECK ("criterion_score"."value" BETWEEN 0 AND 100),
	CONSTRAINT "criterion_score_version" CHECK ("criterion_score"."changed_at_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "score_sheet" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"judge_user_id" uuid NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"comment_version" integer DEFAULT 0 NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "score_sheet_assignment_unique" UNIQUE("round_id","entry_id","judge_user_id"),
	CONSTRAINT "score_sheet_version" CHECK ("score_sheet"."version" >= 0 AND "score_sheet"."comment_version" BETWEEN 0 AND "score_sheet"."version"),
	CONSTRAINT "score_sheet_comment_length" CHECK (char_length("score_sheet"."comment") <= 2000),
	CONSTRAINT "score_sheet_completed" CHECK (NOT "score_sheet"."complete" OR "score_sheet"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "criterion_score" ADD CONSTRAINT "criterion_score_score_sheet_id_score_sheet_id_fk" FOREIGN KEY ("score_sheet_id") REFERENCES "public"."score_sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_score" ADD CONSTRAINT "criterion_score_criterion_id_rubric_criterion_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criterion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_sheet" ADD CONSTRAINT "score_sheet_round_id_entry_id_judge_user_id_round_assignment_round_id_entry_id_judge_user_id_fk" FOREIGN KEY ("round_id","entry_id","judge_user_id") REFERENCES "public"."round_assignment"("round_id","entry_id","judge_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "criterion_score_criterion_idx" ON "criterion_score" USING btree ("criterion_id");