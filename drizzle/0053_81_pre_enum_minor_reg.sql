-- Custom SQL migration file, put your code below! --
-- #81: the values a minor's registration and its messages need, ahead of
-- the DDL (rule F2): pending migrations run in one transaction, so no DDL
-- in this unit names them.
ALTER TYPE "public"."message_suppression_reason" ADD VALUE IF NOT EXISTS 'no_guardian';--> statement-breakpoint
ALTER TYPE "public"."registration_status" ADD VALUE IF NOT EXISTS 'pending_guardian';
