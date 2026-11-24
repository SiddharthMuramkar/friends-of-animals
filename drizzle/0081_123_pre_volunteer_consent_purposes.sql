-- Custom SQL migration file, put your code below! --
-- #123: the volunteer declarations are consent documents staff publish.
-- Rule F2: each value ships here, and nothing in this deploy uses it.
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'volunteer_safeguarding_declaration';--> statement-breakpoint
ALTER TYPE "public"."consent_purpose" ADD VALUE IF NOT EXISTS 'volunteer_code_of_conduct';
