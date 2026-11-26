CREATE TYPE "public"."competition_invitation_status" AS ENUM('queued', 'sent', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."competition_invitation_trigger" AS ENUM('results_published', 'pilot_backfill');--> statement-breakpoint
CREATE TABLE "competition_invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"trigger" "competition_invitation_trigger" NOT NULL,
	"status" "competition_invitation_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "competition_invitation_once" UNIQUE("competition_id","participant_profile_id")
);
--> statement-breakpoint
ALTER TABLE "competition_invitation" ADD CONSTRAINT "competition_invitation_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_invitation" ADD CONSTRAINT "competition_invitation_release_id_result_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."result_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_invitation" ADD CONSTRAINT "competition_invitation_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_invitation" ADD CONSTRAINT "competition_invitation_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_invitation_profile_idx" ON "competition_invitation" USING btree ("participant_profile_id");--> statement-breakpoint
CREATE INDEX "competition_invitation_recipient_idx" ON "competition_invitation" USING btree ("recipient_user_id");