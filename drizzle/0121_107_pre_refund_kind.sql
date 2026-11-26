-- Custom SQL migration file, put your code below! --
ALTER TYPE "public"."refund_kind" ADD VALUE IF NOT EXISTS 'recurring_after_cancel';
