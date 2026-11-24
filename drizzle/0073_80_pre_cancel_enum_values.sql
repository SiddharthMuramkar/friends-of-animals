-- #80 (80b): the cancelled values a cancelled competition and its
-- registrations need, ahead of the DDL (rule F2): pending migrations run in
-- one transaction, so no DDL or data statement in this unit names them.
ALTER TYPE "public"."competition_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."registration_status" ADD VALUE IF NOT EXISTS 'cancelled';
