ALTER TABLE "participant_profile" DROP CONSTRAINT "participant_profile_pin_code_format";--> statement-breakpoint
ALTER TABLE "participant_profile" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "participant_profile" ADD COLUMN "participant_code" text;--> statement-breakpoint
ALTER TABLE "participant_profile" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "participant_profile" ADD COLUMN "school_name" text;--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_profile_self_owner_unique" ON "participant_profile" USING btree ("owner_user_id") WHERE "participant_profile"."owner_kind" = 'self';--> statement-breakpoint
CREATE INDEX "participant_profile_owner_user_id_idx" ON "participant_profile" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_participant_code_unique" UNIQUE("participant_code");--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_country_format" CHECK ("participant_profile"."country" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_owner_user" CHECK ("participant_profile"."owner_user_id" IS NULL OR "participant_profile"."owner_kind" <> 'institution');--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_participant_code_format" CHECK ("participant_profile"."participant_code" ~ '^FOA-P-[0-9]{2}[0-9A-HJKMNP-TV-Z]{6}$');--> statement-breakpoint
ALTER TABLE "participant_profile" ADD CONSTRAINT "participant_profile_pin_code_format" CHECK ("participant_profile"."pin_code" ~ '^[1-9][0-9]{5}$' OR ("participant_profile"."country" IS NOT NULL AND "participant_profile"."country" <> 'IN' AND "participant_profile"."pin_code" ~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$'));