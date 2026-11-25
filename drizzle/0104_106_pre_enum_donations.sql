-- Custom SQL migration file, put your code below! --
ALTER TYPE "public"."refund_kind" ADD VALUE IF NOT EXISTS 'foreign_payment';--> statement-breakpoint
ALTER TYPE "public"."payment_review_reason" ADD VALUE IF NOT EXISTS 'donation_expired';
