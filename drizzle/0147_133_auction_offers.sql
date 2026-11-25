CREATE TYPE "public"."auction_delivery_status" AS ENUM('awaiting_address', 'pending_dispatch', 'dispatched', 'delivered', 'receipt_confirmed');--> statement-breakpoint
CREATE TYPE "public"."auction_offer_status" AS ENUM('open', 'paid', 'expired', 'superseded');--> statement-breakpoint
CREATE TABLE "auction_offer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid,
	"bid_id" uuid,
	"batch_id" uuid,
	"competition_id" uuid NOT NULL,
	"lot_code" text NOT NULL,
	"status" "auction_offer_status" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"creator_share_bps" integer NOT NULL,
	"offered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"delivery_status" "auction_delivery_status",
	"address_ciphertext" text,
	"courier" text,
	"tracking_number" text,
	"delivery_updated_at" timestamp with time zone,
	CONSTRAINT "auction_offer_batch_unique" UNIQUE("batch_id"),
	CONSTRAINT "auction_offer_terms" CHECK ("auction_offer"."amount_paise" > 0 AND "auction_offer"."expires_at" > "auction_offer"."offered_at" AND "auction_offer"."creator_share_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "auction_offer_paid" CHECK (("auction_offer"."status" = 'paid') = ("auction_offer"."paid_at" IS NOT NULL AND "auction_offer"."batch_id" IS NOT NULL AND "auction_offer"."delivery_status" IS NOT NULL))
);
--> statement-breakpoint
DROP INDEX "auction_lot_one_active_artwork";--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "auction_creator_share_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auction_offer" ADD CONSTRAINT "auction_offer_lot_id_auction_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."auction_lot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_offer" ADD CONSTRAINT "auction_offer_bid_id_auction_bid_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."auction_bid"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_offer" ADD CONSTRAINT "auction_offer_batch_id_payment_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_offer" ADD CONSTRAINT "auction_offer_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_offer_one_live_lot" ON "auction_offer" USING btree ("lot_id") WHERE "auction_offer"."status" IN ('open','paid');--> statement-breakpoint
CREATE INDEX "auction_offer_bid_idx" ON "auction_offer" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "auction_offer_lot_idx" ON "auction_offer" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auction_lot_one_active_artwork" ON "auction_lot" USING btree ("artwork_id") WHERE "auction_lot"."status" IN ('draft', 'scheduled', 'open', 'closed', 'awaiting_payment', 'sold');--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_auction_creator_share" CHECK ("competition"."auction_creator_share_bps" BETWEEN 0 AND 10000);