CREATE TYPE "public"."institution_invitation_channel" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."institution_invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TABLE "institution_invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"channel" "institution_invitation_channel" NOT NULL,
	"identifier_ciphertext" text NOT NULL,
	"identifier_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text,
	"status" "institution_invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	CONSTRAINT "institution_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "institution_invitation_token_only_while_pending" CHECK ("institution_invitation"."status" = 'pending' OR "institution_invitation"."token_ciphertext" IS NULL),
	CONSTRAINT "institution_invitation_accepted_at_matches_status" CHECK (("institution_invitation"."status" = 'accepted') = ("institution_invitation"."accepted_at" IS NOT NULL)),
	CONSTRAINT "institution_invitation_revoked_at_matches_status" CHECK (("institution_invitation"."status" = 'revoked') = ("institution_invitation"."revoked_at" IS NOT NULL)),
	CONSTRAINT "institution_invitation_expires_after_creation" CHECK ("institution_invitation"."expires_at" > "institution_invitation"."created_at")
);
--> statement-breakpoint
ALTER TABLE "institution_invitation" ADD CONSTRAINT "institution_invitation_institution_id_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitation" ADD CONSTRAINT "institution_invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitation" ADD CONSTRAINT "institution_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_invitation" ADD CONSTRAINT "institution_invitation_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "institution_invitation_one_pending_per_identifier" ON "institution_invitation" USING btree ("institution_id","identifier_hash") WHERE "institution_invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "institution_invitation_institution_id_idx" ON "institution_invitation" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "institution_invitation_invited_by_user_id_idx" ON "institution_invitation" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "institution_invitation_accepted_by_user_id_idx" ON "institution_invitation" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE INDEX "institution_invitation_revoked_by_user_id_idx" ON "institution_invitation" USING btree ("revoked_by_user_id");