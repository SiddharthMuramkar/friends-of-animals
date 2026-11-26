CREATE TYPE "public"."judging_level" AS ENUM('city_district', 'state', 'national', 'global');--> statement-breakpoint
CREATE TYPE "public"."judging_round_status" AS ENUM('draft', 'open', 'locked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."round_entry_source" AS ENUM('verified_entries', 'round_finalists');--> statement-breakpoint
CREATE TYPE "public"."judge_conflict_source" AS ENUM('declared', 'staff');--> statement-breakpoint
CREATE TYPE "public"."judge_invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TABLE "judging_round" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"level" "judging_level" DEFAULT 'national' NOT NULL,
	"status" "judging_round_status" DEFAULT 'draft' NOT NULL,
	"judges_physical" boolean DEFAULT true NOT NULL,
	"award_scheme" "award_scheme" DEFAULT 'ranked_123' NOT NULL,
	"entry_source" "round_entry_source" DEFAULT 'verified_entries' NOT NULL,
	"source_round_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"opened_by_user_id" uuid,
	"opened_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "judging_round_name_unique" UNIQUE("competition_id","name_key"),
	CONSTRAINT "judging_round_source" CHECK (("judging_round"."entry_source" = 'round_finalists') = ("judging_round"."source_round_id" IS NOT NULL) AND "judging_round"."source_round_id" IS DISTINCT FROM "judging_round"."id"),
	CONSTRAINT "judging_round_name_length" CHECK (char_length("judging_round"."name") BETWEEN 1 AND 120),
	CONSTRAINT "judging_round_cancel_reason" CHECK (("judging_round"."status" = 'cancelled') = ("judging_round"."cancelled_at" IS NOT NULL AND "judging_round"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "judging_round_rubric" (
	"round_id" uuid NOT NULL,
	"discipline" "competition_discipline" NOT NULL,
	"rubric_id" uuid NOT NULL,
	CONSTRAINT "judging_round_rubric_round_id_discipline_pk" PRIMARY KEY("round_id","discipline")
);
--> statement-breakpoint
CREATE TABLE "round_assignment" (
	"round_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"judge_user_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_assignment_round_id_entry_id_judge_user_id_pk" PRIMARY KEY("round_id","entry_id","judge_user_id")
);
--> statement-breakpoint
CREATE TABLE "round_entry" (
	"round_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"admitted_by_user_id" uuid,
	"admitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_entry_round_id_entry_id_pk" PRIMARY KEY("round_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "judge_conflict" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"judge_user_id" uuid NOT NULL,
	"institution_id" uuid,
	"entry_id" uuid,
	"source" "judge_conflict_source" NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "judge_conflict_target" CHECK (("judge_conflict"."source" = 'declared' AND "judge_conflict"."institution_id" IS NOT NULL AND "judge_conflict"."entry_id" IS NULL) OR ("judge_conflict"."source" = 'staff' AND "judge_conflict"."institution_id" IS NULL AND "judge_conflict"."entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "judge_invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"email_ciphertext" text NOT NULL,
	"email_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text,
	"status" "judge_invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"accepted_user_id" uuid,
	CONSTRAINT "judge_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "judge_invitation_token_pending" CHECK ("judge_invitation"."status" = 'pending' OR "judge_invitation"."token_ciphertext" IS NULL),
	CONSTRAINT "judge_invitation_expiry" CHECK ("judge_invitation"."expires_at" > "judge_invitation"."created_at")
);
--> statement-breakpoint
CREATE TABLE "judge_onboarding" (
	"round_id" uuid NOT NULL,
	"judge_user_id" uuid NOT NULL,
	"conduct_consent_event_id" uuid,
	"confidentiality_consent_event_id" uuid,
	"conflicts_declared_at" timestamp with time zone,
	"conflicts_none" boolean,
	"conflict_statement" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "judge_onboarding_round_id_judge_user_id_pk" PRIMARY KEY("round_id","judge_user_id")
);
--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_opened_by_user_id_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round" ADD CONSTRAINT "judging_round_source_round_id_judging_round_id_fk" FOREIGN KEY ("source_round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round_rubric" ADD CONSTRAINT "judging_round_rubric_round_id_judging_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judging_round_rubric" ADD CONSTRAINT "judging_round_rubric_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_assignment" ADD CONSTRAINT "round_assignment_judge_user_id_user_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_assignment" ADD CONSTRAINT "round_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_assignment" ADD CONSTRAINT "round_assignment_round_id_entry_id_round_entry_round_id_entry_id_fk" FOREIGN KEY ("round_id","entry_id") REFERENCES "public"."round_entry"("round_id","entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_entry" ADD CONSTRAINT "round_entry_round_id_judging_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_entry" ADD CONSTRAINT "round_entry_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_entry" ADD CONSTRAINT "round_entry_admitted_by_user_id_user_id_fk" FOREIGN KEY ("admitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_conflict" ADD CONSTRAINT "judge_conflict_round_id_judging_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_conflict" ADD CONSTRAINT "judge_conflict_judge_user_id_user_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_conflict" ADD CONSTRAINT "judge_conflict_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_conflict" ADD CONSTRAINT "judge_conflict_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_conflict" ADD CONSTRAINT "judge_conflict_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_invitation" ADD CONSTRAINT "judge_invitation_round_id_judging_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_invitation" ADD CONSTRAINT "judge_invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_invitation" ADD CONSTRAINT "judge_invitation_accepted_user_id_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_onboarding" ADD CONSTRAINT "judge_onboarding_round_id_judging_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."judging_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_onboarding" ADD CONSTRAINT "judge_onboarding_judge_user_id_user_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_onboarding" ADD CONSTRAINT "judge_onboarding_conduct_consent_event_id_consent_event_id_fk" FOREIGN KEY ("conduct_consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_onboarding" ADD CONSTRAINT "judge_onboarding_confidentiality_consent_event_id_consent_event_id_fk" FOREIGN KEY ("confidentiality_consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judging_round_created_by_idx" ON "judging_round" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "judging_round_opened_by_idx" ON "judging_round" USING btree ("opened_by_user_id");--> statement-breakpoint
CREATE INDEX "judging_round_cancelled_by_idx" ON "judging_round" USING btree ("cancelled_by_user_id");--> statement-breakpoint
CREATE INDEX "judging_round_rubric_rubric_idx" ON "judging_round_rubric" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "round_assignment_judge_idx" ON "round_assignment" USING btree ("judge_user_id");--> statement-breakpoint
CREATE INDEX "round_assignment_assigned_by_idx" ON "round_assignment" USING btree ("assigned_by_user_id");--> statement-breakpoint
CREATE INDEX "round_entry_entry_idx" ON "round_entry" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "round_entry_admitted_by_idx" ON "round_entry" USING btree ("admitted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "judge_conflict_institution_unique" ON "judge_conflict" USING btree ("round_id","judge_user_id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "judge_conflict_entry_unique" ON "judge_conflict" USING btree ("round_id","judge_user_id","entry_id");--> statement-breakpoint
CREATE INDEX "judge_conflict_judge_idx" ON "judge_conflict" USING btree ("judge_user_id");--> statement-breakpoint
CREATE INDEX "judge_conflict_creator_idx" ON "judge_conflict" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "judge_invitation_one_pending" ON "judge_invitation" USING btree ("round_id","email_hash") WHERE "judge_invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "judge_invitation_inviter_idx" ON "judge_invitation" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "judge_invitation_acceptor_idx" ON "judge_invitation" USING btree ("accepted_user_id");--> statement-breakpoint
CREATE INDEX "judge_onboarding_judge_idx" ON "judge_onboarding" USING btree ("judge_user_id");