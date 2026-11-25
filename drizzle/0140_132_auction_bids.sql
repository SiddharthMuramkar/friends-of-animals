CREATE TABLE "auction_bid" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lot_id" uuid NOT NULL,
	"bidder_user_id" uuid,
	"amount_paise" bigint NOT NULL,
	"declaration_version" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auction_bid_positive_amount" CHECK ("auction_bid"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "auction_bid" ADD CONSTRAINT "auction_bid_lot_id_auction_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."auction_lot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bid" ADD CONSTRAINT "auction_bid_bidder_user_id_user_id_fk" FOREIGN KEY ("bidder_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_bid_lot_amount_unique" ON "auction_bid" USING btree ("lot_id","amount_paise" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auction_bid_bidder_idx" ON "auction_bid" USING btree ("bidder_user_id");