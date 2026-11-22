CREATE TYPE "public"."guardian_invitation_channel" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."guardian_invitation_kind" AS ENUM('teen_login', 'guardian_request');--> statement-breakpoint
CREATE TYPE "public"."guardian_invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."guardian_verification_method" AS ENUM('email_otp', 'phone_otp');--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name_ciphertext" text NOT NULL,
	"phone_ciphertext" text,
	"phone_hash" text,
	"adult_declared_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_method" "guardian_verification_method",
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guardian_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "guardian_verified_with_method" CHECK (("guardian"."verified_at" IS NULL) = ("guardian"."verification_method" IS NULL)),
	CONSTRAINT "guardian_phone_complete" CHECK (("guardian"."phone_ciphertext" IS NULL) = ("guardian"."phone_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "guardian_invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "guardian_invitation_kind" NOT NULL,
	"guardian_id" uuid NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"status" "guardian_invitation_status" DEFAULT 'pending' NOT NULL,
	"channel" "guardian_invitation_channel" NOT NULL,
	"contact_ciphertext" text NOT NULL,
	"contact_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guardian_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "guardian_invitation_token_only_while_pending" CHECK ("guardian_invitation"."status" = 'pending' OR "guardian_invitation"."token_ciphertext" IS NULL),
	CONSTRAINT "guardian_invitation_accepted_at_matches_status" CHECK (("guardian_invitation"."status" = 'accepted') = ("guardian_invitation"."accepted_at" IS NOT NULL)),
	CONSTRAINT "guardian_invitation_revoked_at_matches_status" CHECK (("guardian_invitation"."status" = 'revoked') = ("guardian_invitation"."revoked_at" IS NOT NULL)),
	CONSTRAINT "guardian_invitation_expires_after_creation" CHECK ("guardian_invitation"."expires_at" > "guardian_invitation"."created_at")
);
--> statement-breakpoint
CREATE TABLE "guardian_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guardian_id" uuid NOT NULL,
	"participant_profile_id" uuid NOT NULL,
	"relationship" "guardian_relationship" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "participant_profile" ADD COLUMN "login_user_id" uuid;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_invitation" ADD CONSTRAINT "guardian_invitation_guardian_id_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_invitation" ADD CONSTRAINT "guardian_invitation_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_invitation" ADD CONSTRAINT "guardian_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_guardian_id_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_participant_profile_id_participant_profile_id_fk" FOREIGN KEY ("participant_profile_id") REFERENCES "public"."participant_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_invitation_one_pending_per_child" ON "guardian_invitation" USING btree ("participant_profile_id","kind") WHERE "guardian_invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "guardian_invitation_guardian_id_idx" ON "guardian_invitation" USING btree ("guardian_id");--> statement-breakpoint
CREATE INDEX "guardian_invitation_accepted_by_user_id_idx" ON "guardian_invitation" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_link_active_pair_unique" ON "guardian_link" USING btree ("guardian_id","participant_profile_id") WHERE "guardian_link"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "guardian_link_guardian_id_idx" ON "guardian_link" USING btree ("guardian_id");--> statement-breakpoint
CREATE INDEX "guardian_link_participant_profile_id_idx" ON "guardian_link" USING btree ("participant_profile_id");--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_login_user_id_user_id_fk" FOREIGN KEY ("login_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_profile_login_user_unique" ON "participant_profile" USING btree ("login_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_profile_guardian_identity_unique" ON "participant_profile" USING btree ("owner_user_id","identity_hash") WHERE "participant_profile"."owner_kind" = 'guardian';--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_login_user" CHECK ("participant_profile"."login_user_id" IS NULL OR "participant_profile"."owner_kind" = 'guardian');