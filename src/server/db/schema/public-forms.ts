// Shared guards for public forms (#113; reused by #116 and later public
// forms): per-sender rate limits and spent human-check challenges.
// `form_rate_limit` keys are keyed hashes, never an address or an IP.
//
// Retention: both tables clean up after themselves. The limiter deletes a
// form's ended windows when it next counts, and the proof-of-work check
// deletes redemptions older than a challenge's lifetime, after which the
// challenge could not be spent again anyway.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Submissions one sender made to one form in one fixed window. */
export const formRateLimit = pgTable(
  "form_rate_limit",
  {
    /** Which form counts, such as "contact". */
    form: text().notNull(),
    /** What the key is, such as "ip" or "email". */
    scope: text().notNull(),
    /** A keyed hash of the IP network or the normalised address. */
    keyHash: text("key_hash").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    count: integer().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.form, table.scope, table.keyHash, table.windowStart],
    }),
    index("form_rate_limit_window_start_idx").on(table.windowStart),
    check("form_rate_limit_count_positive", sql`${table.count} > 0`),
  ]
);

/**
 * Human-check challenges already spent, by their random salt, so each
 * proof works once. Challenges themselves are never stored: they travel
 * signed (src/server/modules/public-forms/domain/challenge-token.ts).
 */
export const humanCheckRedemption = pgTable(
  "human_check_redemption",
  {
    salt: text().primaryKey(),
    redeemedAt: timestamptz("redeemed_at").notNull(),
  },
  (table) => [
    index("human_check_redemption_redeemed_at_idx").on(table.redeemedAt),
  ]
);
