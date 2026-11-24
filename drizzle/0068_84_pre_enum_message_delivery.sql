-- Custom SQL migration file, put your code below! --
-- #84: a delivery claimed by one run for an external destination, ahead of
-- the DDL (rule F2): pending migrations run in one transaction, so nothing
-- in this unit's migrations names it.
ALTER TYPE "public"."message_delivery_status" ADD VALUE IF NOT EXISTS 'sending';
