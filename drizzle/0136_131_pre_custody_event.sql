ALTER TYPE "public"."artwork_custody_kind" ADD VALUE IF NOT EXISTS 'auction_reserved';--> statement-breakpoint
ALTER TYPE "public"."artwork_custody_kind" ADD VALUE IF NOT EXISTS 'auction_released';
