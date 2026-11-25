import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { physicalArtwork, physicalArtworkStatus } from "./physical-artwork";
import { consentEvent } from "./consent";
import { user } from "./identity";
import {
  ACTIVE_LOT_STATUSES,
  LOT_STATUSES,
} from "../../modules/auctions/domain/lot-status";

const stamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const auctionLotStatus = pgEnum("auction_lot_status", LOT_STATUSES);

export const auctionLot = pgTable(
  "auction_lot",
  {
    id: uuid().primaryKey(),
    lotCode: text("lot_code").notNull(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => physicalArtwork.id, { onDelete: "cascade" }),
    consentEventId: uuid("consent_event_id").references(() => consentEvent.id, {
      onDelete: "set null",
    }),
    artworkStatusBeforeListing: physicalArtworkStatus(
      "artwork_status_before_listing"
    ).notNull(),
    status: auctionLotStatus().notNull(),
    story: text().notNull(),
    // Until Results publishes a recognised award, there is no award to display.
    basePricePaise: bigint("base_price_paise", { mode: "bigint" }).notNull(),
    reservePricePaise: bigint("reserve_price_paise", {
      mode: "bigint",
    }).notNull(),
    opensAt: stamp("opens_at").notNull(),
    closesAt: stamp("closes_at").notNull(),
    cancellationReason: text("cancellation_reason"),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: stamp("created_at").notNull(),
    updatedAt: stamp("updated_at").notNull(),
  },
  (t) => [
    unique("auction_lot_lot_code_unique").on(t.lotCode),
    uniqueIndex("auction_lot_one_active_artwork")
      .on(t.artworkId)
      .where(
        sql`${t.status} IN (${sql.raw(ACTIVE_LOT_STATUSES.map((s) => "'" + s + "'").join(", "))})`
      ),
    index("auction_lot_artwork_idx").on(t.artworkId),
    index("auction_lot_status_dates_idx").on(t.status, t.opensAt, t.closesAt),
    check(
      "auction_lot_terms",
      sql`${t.basePricePaise} > 0 AND ${t.reservePricePaise} >= ${t.basePricePaise} AND ${t.closesAt} > ${t.opensAt}`
    ),
    check(
      "auction_lot_previous_status",
      sql`${t.artworkStatusBeforeListing} IN ('verified','on_exhibition','retained')`
    ),
    check(
      "auction_lot_code_format",
      sql`${t.lotCode} ~ '^LOT-[0-9]{2}-[0-9A-HJKMNP-TV-Z]{5}$'`
    ),
    check(
      "auction_lot_story_length",
      sql`char_length(${t.story}) BETWEEN 1 AND 2000`
    ),
  ]
);
export type AuctionLotRow = typeof auctionLot.$inferSelect;

/** The accepted bid history is immutable except for erasing an account link.
 * No bidder identity is copied into the lot or its public projection. */
export const auctionBid = pgTable(
  "auction_bid",
  {
    id: uuid().primaryKey(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => auctionLot.id, { onDelete: "cascade" }),
    bidderUserId: uuid("bidder_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    // The declaration version captures precisely which adult/binding bid
    // statement the bidder accepted, without gathering a new DOB or phone.
    declarationVersion: text("declaration_version").notNull(),
    placedAt: stamp("placed_at").notNull(),
  },
  (t) => [
    uniqueIndex("auction_bid_lot_amount_unique").on(
      t.lotId,
      t.amountPaise.desc()
    ),
    index("auction_bid_bidder_idx").on(t.bidderUserId),
    check("auction_bid_positive_amount", sql`${t.amountPaise} > 0`),
  ]
);
export type AuctionBidRow = typeof auctionBid.$inferSelect;
