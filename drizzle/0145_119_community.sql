CREATE TYPE "public"."community_member_status" AS ENUM('active', 'left');--> statement-breakpoint
CREATE TYPE "public"."engagement_milestone_kind" AS ENUM('participant', 'school_winner', 'foa_finalist', 'community_member', 'volunteer', 'ambassador');--> statement-breakpoint
CREATE TABLE "community_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_user_id" uuid,
	"subject_profile_id" uuid,
	"joined_by_user_id" uuid,
	"display_name_ciphertext" text,
	"about_ciphertext" text,
	"status" "community_member_status" NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "community_member_subject_unique" UNIQUE NULLS NOT DISTINCT("subject_user_id","subject_profile_id"),
	CONSTRAINT "community_member_one_subject" CHECK (num_nonnulls("community_member"."subject_user_id","community_member"."subject_profile_id") = 1),
	CONSTRAINT "community_member_status_dates" CHECK (("community_member"."status" = 'active' AND "community_member"."left_at" IS NULL AND "community_member"."display_name_ciphertext" IS NOT NULL) OR ("community_member"."status" = 'left' AND "community_member"."left_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "engagement_milestone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_user_id" uuid,
	"subject_profile_id" uuid,
	"kind" "engagement_milestone_kind" NOT NULL,
	"competition_id" uuid,
	"achieved_at" timestamp with time zone NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "engagement_milestone_logical_unique" UNIQUE NULLS NOT DISTINCT("subject_user_id","subject_profile_id","kind","competition_id"),
	CONSTRAINT "engagement_milestone_one_subject" CHECK (num_nonnulls("engagement_milestone"."subject_user_id","engagement_milestone"."subject_profile_id") = 1),
	CONSTRAINT "engagement_milestone_competition_scope" CHECK (("engagement_milestone"."kind" IN ('participant','school_winner','foa_finalist')) = ("engagement_milestone"."competition_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "timeline_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_user_id" uuid,
	"subject_profile_id" uuid,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"milestone_id" uuid,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "timeline_entry_source_unique" UNIQUE NULLS NOT DISTINCT("subject_user_id","subject_profile_id","source_key"),
	CONSTRAINT "timeline_entry_one_subject" CHECK (num_nonnulls("timeline_entry"."subject_user_id","timeline_entry"."subject_profile_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "community_member" ADD CONSTRAINT "community_member_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_member" ADD CONSTRAINT "community_member_subject_profile_id_participant_profile_id_fk" FOREIGN KEY ("subject_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_member" ADD CONSTRAINT "community_member_joined_by_user_id_user_id_fk" FOREIGN KEY ("joined_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_milestone" ADD CONSTRAINT "engagement_milestone_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_milestone" ADD CONSTRAINT "engagement_milestone_subject_profile_id_participant_profile_id_fk" FOREIGN KEY ("subject_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_milestone" ADD CONSTRAINT "engagement_milestone_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entry" ADD CONSTRAINT "timeline_entry_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entry" ADD CONSTRAINT "timeline_entry_subject_profile_id_participant_profile_id_fk" FOREIGN KEY ("subject_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entry" ADD CONSTRAINT "timeline_entry_milestone_id_engagement_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."engagement_milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_member_profile_idx" ON "community_member" USING btree ("subject_profile_id");--> statement-breakpoint
CREATE INDEX "community_member_joined_by_idx" ON "community_member" USING btree ("joined_by_user_id");--> statement-breakpoint
CREATE INDEX "community_member_status_idx" ON "community_member" USING btree ("status","joined_at","id");--> statement-breakpoint
CREATE INDEX "engagement_milestone_profile_idx" ON "engagement_milestone" USING btree ("subject_profile_id");--> statement-breakpoint
CREATE INDEX "engagement_milestone_competition_idx" ON "engagement_milestone" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "timeline_entry_user_date_idx" ON "timeline_entry" USING btree ("subject_user_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "timeline_entry_profile_date_idx" ON "timeline_entry" USING btree ("subject_profile_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "timeline_entry_milestone_idx" ON "timeline_entry" USING btree ("milestone_id");