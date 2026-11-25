CREATE TYPE "public"."club_member_role" AS ENUM('student', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."club_status" AS ENUM('applied', 'approved', 'declined', 'withdrawn', 'suspended', 'closed');--> statement-breakpoint
CREATE TABLE "club" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"name" text NOT NULL,
	"applicant_user_id" uuid,
	"applicant_kind" "club_member_role" NOT NULL,
	"applicant_verified" boolean NOT NULL,
	"status" "club_status" NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"from_status" "club_status" NOT NULL,
	"to_status" "club_status" NOT NULL,
	"reason_ciphertext" text,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_membership" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "club_member_role" NOT NULL,
	"affiliation_verified" boolean NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "club_membership_time_order" CHECK ("club_membership"."left_at" IS NULL OR "club_membership"."left_at" >= "club_membership"."joined_at")
);
--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club" ADD CONSTRAINT "club_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_decision" ADD CONSTRAINT "club_decision_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_decision" ADD CONSTRAINT "club_decision_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_membership" ADD CONSTRAINT "club_membership_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_membership" ADD CONSTRAINT "club_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_institution_status_idx" ON "club" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "club_applicant_idx" ON "club" USING btree ("applicant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_pending_application_unique" ON "club" USING btree ("applicant_user_id","institution_id") WHERE "club"."status" = 'applied';--> statement-breakpoint
CREATE INDEX "club_decision_club_idx" ON "club_decision" USING btree ("club_id","decided_at");--> statement-breakpoint
CREATE INDEX "club_decision_actor_idx" ON "club_decision" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_membership_active_unique" ON "club_membership" USING btree ("club_id","user_id") WHERE "club_membership"."left_at" IS NULL;--> statement-breakpoint
CREATE INDEX "club_membership_user_idx" ON "club_membership" USING btree ("user_id");