import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { SOCIAL_CHANNELS } from "../../modules/reports/domain/social-snapshot";

export const socialMetricChannel = pgEnum(
  "social_metric_channel",
  SOCIAL_CHANNELS
);

export const socialSnapshot = pgTable(
  "social_snapshot",
  {
    id: uuid().primaryKey(),
    channel: socialMetricChannel().notNull(),
    // An observation's IST calendar date, not a time or a user identity.
    recordedFor: date("recorded_for").notNull(),
    followers: integer().notNull(),
    posts: integer().notNull(),
    reach: integer(),
    impressions: integer(),
    engagements: integer(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("social_snapshot_channel_date_unique").on(t.channel, t.recordedFor),
    check(
      "social_snapshot_nonnegative",
      sql`${t.followers} >= 0 AND ${t.posts} >= 0 AND (${t.reach} IS NULL OR ${t.reach} >= 0) AND (${t.impressions} IS NULL OR ${t.impressions} >= 0) AND (${t.engagements} IS NULL OR ${t.engagements} >= 0)`
    ),
  ]
);
