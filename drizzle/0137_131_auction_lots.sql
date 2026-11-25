CREATE TYPE "public"."auction_lot_status" AS ENUM('draft', 'scheduled', 'open', 'closed', 'awaiting_payment', 'sold', 'unsold', 'relisted', 'cancelled');--> statement-breakpoint
CREATE TABLE "auction_lot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_code" text NOT NULL,
	"artwork_id" uuid NOT NULL,
	"consent_event_id" uuid,
	"artwork_status_before_listing" "physical_artwork_status" NOT NULL,
	"status" "auction_lot_status" NOT NULL,
	"story" text NOT NULL,
	"base_price_paise" bigint NOT NULL,
	"reserve_price_paise" bigint NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"cancellation_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auction_lot_lot_code_unique" UNIQUE("lot_code"),
	CONSTRAINT "auction_lot_terms" CHECK ("auction_lot"."base_price_paise" > 0 AND "auction_lot"."reserve_price_paise" >= "auction_lot"."base_price_paise" AND "auction_lot"."closes_at" > "auction_lot"."opens_at"),
	CONSTRAINT "auction_lot_previous_status" CHECK ("auction_lot"."artwork_status_before_listing" IN ('verified','on_exhibition','retained')),
	CONSTRAINT "auction_lot_code_format" CHECK ("auction_lot"."lot_code" ~ '^LOT-[0-9]{2}-[0-9A-HJKMNP-TV-Z]{5}$'),
	CONSTRAINT "auction_lot_story_length" CHECK (char_length("auction_lot"."story") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "auction_lot" ADD CONSTRAINT "auction_lot_artwork_id_physical_artwork_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."physical_artwork"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_lot" ADD CONSTRAINT "auction_lot_consent_event_id_consent_event_id_fk" FOREIGN KEY ("consent_event_id") REFERENCES "public"."consent_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_lot" ADD CONSTRAINT "auction_lot_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_lot_one_active_artwork" ON "auction_lot" USING btree ("artwork_id") WHERE "auction_lot"."status" IN ('draft', 'scheduled', 'open', 'closed', 'awaiting_payment', 'relisted');--> statement-breakpoint
CREATE INDEX "auction_lot_artwork_idx" ON "auction_lot" USING btree ("artwork_id");--> statement-breakpoint
CREATE INDEX "auction_lot_status_dates_idx" ON "auction_lot" USING btree ("status","opens_at","closes_at");