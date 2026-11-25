// Competitions (#70). A competition is a draft until a competition manager
// publishes it; only then do the public pages show it. Its age groups,
// categories (one discipline for one age group) and key dates are rows of
// their own, so later tickets can point at them: entries at a category,
// #71's status schedule at the key dates.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { KEY_DATE_KINDS } from "../../modules/competitions/domain/key-dates";
import {
  COMPETITION_STATUSES,
  DIGITAL_SCOPES,
  DISCIPLINES,
  PARTICIPATIONS,
  PHYSICAL_ARTWORK_KINDS,
} from "../../modules/competitions/domain/vocabulary";
import { user } from "./identity";
import { outbox } from "./outbox";

/**
 * The status machine's statuses. #71 added the ones the schedule moves to
 * (registration open and closed) in a migration of their own; #80 adds
 * cancelled the same way, and #90 foa_judging. A value is never used in the migration that adds
 * it (rule F2).
 */
export const competitionStatusEnum = pgEnum(
  "competition_status",
  COMPETITION_STATUSES
);
export const competitionParticipationEnum = pgEnum(
  "competition_participation",
  PARTICIPATIONS
);
export const competitionDisciplineEnum = pgEnum(
  "competition_discipline",
  DISCIPLINES
);
export const competitionDigitalScopeEnum = pgEnum(
  "competition_digital_scope",
  DIGITAL_SCOPES
);
export const competitionPhysicalArtworkEnum = pgEnum(
  "competition_physical_artwork",
  PHYSICAL_ARTWORK_KINDS
);
export const competitionKeyDateKindEnum = pgEnum(
  "competition_key_date_kind",
  KEY_DATE_KINDS
);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const competition = pgTable(
  "competition",
  {
    id: uuid().primaryKey(),
    /** 3 to 6 capital letters and a two-digit year (PAWS27). */
    code: text().notNull(),
    /** /competitions/<slug>; made from the name once, then kept. */
    slug: text().notNull(),
    name: text().notNull(),
    // The text fields stay null in a draft until the manager writes them;
    // publishing needs every one.
    theme: text(),
    welfareMessage: text("welfare_message"),
    rules: text(),
    permittedMaterials: text("permitted_materials"),
    duration: text(),
    participation: competitionParticipationEnum(),
    /** In the vocabulary's order, no repeats. */
    disciplines: competitionDisciplineEnum()
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Ages are whole years on this date. */
    ageCutoffDate: date("age_cutoff_date", { mode: "string" }),
    digitalScope: competitionDigitalScopeEnum("digital_scope")
      .notNull()
      .default("all_participants"),
    shortlistPerCategory: integer("shortlist_per_category")
      .notNull()
      .default(5),
    schoolPositions: integer("school_positions").notNull().default(3),
    physicalArtwork: competitionPhysicalArtworkEnum("physical_artwork")
      .notNull()
      .default("all_shortlisted"),
    /** How many of the shortlist send their artwork, for `top_n` only. */
    physicalArtworkTopN: integer("physical_artwork_top_n"),
    publicDisplay: boolean("public_display").notNull().default(false),
    auctionPermitted: boolean("auction_permitted").notNull().default(false),
    status: competitionStatusEnum().notNull().default("draft"),
    publishedAt: timestamptz("published_at"),
    /** When a super admin cancelled it (#80); null unless cancelled. */
    cancelledAt: timestamptz("cancelled_at"),
    /** Why, as the super admin wrote it: 1 to 500 characters, shown to
     * staff and in the audit log; set with `cancelled_at`. */
    cancelReason: text("cancel_reason"),
    /** Null for seed data, or once the creating user's account is gone. */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("competition_code_unique").on(table.code),
    unique("competition_slug_unique").on(table.slug),
    check(
      "competition_code_format",
      sql`${table.code} ~ '^[A-Z]{3,6}[0-9]{2}$'`
    ),
    check("competition_slug_format", sql`${table.slug} ~ '^[a-z0-9-]{3,80}$'`),
    check(
      "competition_physical_artwork_top_n",
      sql`(${table.physicalArtwork} = 'top_n') = (${table.physicalArtworkTopN} IS NOT NULL)`
    ),
    check(
      "competition_counts_not_negative",
      sql`${table.shortlistPerCategory} >= 0 AND ${table.schoolPositions} >= 0`
    ),
    // A draft was never published, and a competition that left draft was,
    // unless it was cancelled as a draft (#80). Written with cancelled_at,
    // not the cancelled status: a value is never used by DDL in the PR that
    // adds it (rule F2).
    check(
      "competition_published_at_matches_status",
      sql`(${table.status} <> 'draft' OR ${table.publishedAt} IS NULL) AND (${table.publishedAt} IS NOT NULL OR ${table.status} = 'draft' OR ${table.cancelledAt} IS NOT NULL)`
    ),
    // Only a cancelled competition carries cancellation metadata. Compared
    // as text, so no enum value is looked up and a status added later
    // (#90's foa_judging) needs no change here (rule F2).
    check(
      "competition_cancellation_complete",
      sql`(${table.status}::text = 'cancelled') = (${table.cancelledAt} IS NOT NULL)
        AND (${table.cancelledAt} IS NULL) = (${table.cancelReason} IS NULL)`
    ),
    check(
      "competition_cancel_reason_present",
      sql`${table.cancelReason} IS NULL OR length(trim(${table.cancelReason})) > 0`
    ),
    index("competition_status_idx").on(table.status),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("competition_created_by_user_id_idx").on(table.createdByUserId),
  ]
);

export type Competition = typeof competition.$inferSelect;

/** A reserved family email. A null sentAt means the outcome is unknown. */
export const competitionCancellationEmail = pgTable(
  "competition_cancellation_email",
  {
    deliveryId: uuid("delivery_id")
      .primaryKey()
      .references(() => outbox.id, { onDelete: "cascade" }),
    sentAt: timestamptz("sent_at"),
  }
);

export const competitionAgeGroup = pgTable(
  "competition_age_group",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    label: text().notNull(),
    // A draft may hold a range publishing would refuse (inverted, out of
    // bounds, overlapping); publishProblems names it.
    minAge: integer("min_age").notNull(),
    maxAge: integer("max_age").notNull(),
    /** The order the manager listed the groups in, from 0. */
    position: integer().notNull(),
  },
  (table) => [
    unique("competition_age_group_position_unique").on(
      table.competitionId,
      table.position
    ),
    // Categories name their age group by label on the form.
    uniqueIndex("competition_age_group_label_unique").on(
      table.competitionId,
      sql`lower(${table.label})`
    ),
    check(
      "competition_age_group_ages_not_negative",
      sql`${table.minAge} >= 0 AND ${table.maxAge} >= 0`
    ),
  ]
);

export type CompetitionAgeGroup = typeof competitionAgeGroup.$inferSelect;

export const competitionCategory = pgTable(
  "competition_category",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    discipline: competitionDisciplineEnum().notNull(),
    ageGroupId: uuid("age_group_id")
      .notNull()
      .references(() => competitionAgeGroup.id, { onDelete: "cascade" }),
  },
  (table) => [
    unique("competition_category_unique").on(
      table.competitionId,
      table.discipline,
      table.ageGroupId
    ),
    // Deleting an age group deletes its categories; the index keeps that
    // from scanning.
    index("competition_category_age_group_id_idx").on(table.ageGroupId),
  ]
);

export const competitionKeyDate = pgTable(
  "competition_key_date",
  {
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    kind: competitionKeyDateKindEnum().notNull(),
    /** The exact instant; admins enter and read it in IST. */
    at: timestamptz("at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.competitionId, table.kind] })]
);
