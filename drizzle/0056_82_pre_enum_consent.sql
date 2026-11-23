-- Custom SQL migration file, put your code below! --
-- #82: the guardian purposes and the participant-profile subject, ahead of
-- the DDL (rule F2): pending migrations run in one transaction, so no DDL
-- in this unit names them.
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'participation';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'public_display';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'display_school';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'display_city';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'social_media';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'auction';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'communications';--> statement-breakpoint
ALTER TYPE "public"."consent_subject_type" ADD VALUE IF NOT EXISTS 'participant_profile';
