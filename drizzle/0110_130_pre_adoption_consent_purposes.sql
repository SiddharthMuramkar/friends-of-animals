-- Custom SQL migration file, put your code below! ---- #130: an adopter's two consent purposes, ahead of anything that names
-- them (rule F2): pending migrations run in one transaction, so no DDL or
-- data statement in this unit uses them.
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'adoption_contact_sharing';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'adoption_success_story';
