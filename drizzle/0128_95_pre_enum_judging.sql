-- Custom SQL migration file, put your code below! --
ALTER TYPE "public"."role_scope_type" ADD VALUE IF NOT EXISTS 'round';
--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'judge_conduct';
--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'judge_confidentiality';
