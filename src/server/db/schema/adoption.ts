// Adoption listings (#129): animals that verified directory listings put up
// for adoption, and their photos. The enums are built from the module's
// domain lists, so they can't drift. Every status exists from the start
// (src/server/modules/adoption/domain/status.ts): later work adds allowed
// moves, never enum values.
//
// An animal's age is never stored: `birth_month` holds the first of the
// month that puts it at its estimated age, and ages are worked out from the
// clock.
//
// Foreign keys still to come, once those tables are on this branch:
// `directory_listing_id` to #127's `directory_listing`, and
// `adoption_listing_photo.file_asset_id` to #63's `file_asset`.
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
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ADOPTION_SPECIES,
  ANIMAL_SEXES,
  ANIMAL_SIZES,
  INDIAN_STATES,
} from "../../modules/adoption/domain/details";
import { ADOPTION_LISTING_STATUSES } from "../../modules/adoption/domain/status";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const adoptionListingStatus = pgEnum(
  "adoption_listing_status",
  ADOPTION_LISTING_STATUSES
);

export const adoptionSpecies = pgEnum("adoption_species", ADOPTION_SPECIES);

export const animalSex = pgEnum("animal_sex", ANIMAL_SEXES);

export const animalSize = pgEnum("animal_size", ANIMAL_SIZES);

/** The state keys as a SQL list; each key is lower-case letters and "_". */
const STATE_KEYS_SQL = INDIAN_STATES.map((state) => `'${state.key}'`).join(
  ", "
);

/** One animal up for adoption, under one directory listing. */
export const adoptionListing = pgTable(
  "adoption_listing",
  {
    /** UUIDv7, made in the app. */
    id: uuid().primaryKey(),
    /** The verified organisation or person listing the animal (#127). */
    directoryListingId: uuid("directory_listing_id").notNull(),
    /** /adopt/<slug>: made at creation and never changed. */
    slug: text().notNull().unique(),
    name: text().notNull(),
    species: adoptionSpecies().notNull(),
    breed: text(),
    sex: animalSex().notNull(),
    /** Null: not given. */
    size: animalSize(),
    colour: text(),
    /** The first of the estimated birth month, in India. */
    birthMonth: date("birth_month", { mode: "string" }).notNull(),
    /** Null: not known. */
    sterilised: boolean(),
    about: text(),
    healthNotes: text("health_notes"),
    vaccinationNotes: text("vaccination_notes"),
    /** The adoption conditions the listing sets. */
    conditions: text().notNull(),
    /** A state or union territory key (INDIAN_STATES). */
    state: text().notNull(),
    city: text().notNull(),
    /** The city as browse compares it: normalised and lower-cased. */
    cityKey: text("city_key").notNull(),
    pinCode: text("pin_code").notNull(),
    status: adoptionListingStatus().notNull().default("draft"),
    /** First published. Kept through holds and after it closes. */
    publishedAt: timestamptz("published_at"),
    /** When it was adopted or withdrawn. */
    closedAt: timestamptz("closed_at"),
    /**
     * Who wrote the draft. The listing belongs to the directory listing,
     * so deleting the account keeps the animal and clears this.
     */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // Browse: published animals, newest first, in keyset pages.
    index("adoption_listing_browse_idx").on(
      table.status,
      table.publishedAt.desc(),
      table.id.desc()
    ),
    index("adoption_listing_directory_listing_idx").on(
      table.directoryListingId,
      table.createdAt.desc()
    ),
    check(
      "adoption_listing_birth_month_first_of_month",
      sql`extract(day from ${table.birthMonth}) = 1`
    ),
    check(
      "adoption_listing_pin_code_format",
      sql`${table.pinCode} ~ '^[1-9][0-9]{5}$'`
    ),
    check(
      "adoption_listing_state_known",
      sql`${table.state} IN (${sql.raw(STATE_KEYS_SQL)})`
    ),
    // A draft was never published; a listing that is or was public was.
    check(
      "adoption_listing_published_at_matches_status",
      sql`(${table.status} = 'draft' AND ${table.publishedAt} IS NULL) OR ${table.status} = 'withdrawn' OR (${table.status} IN ('published', 'on_hold', 'adopted') AND ${table.publishedAt} IS NOT NULL)`
    ),
    check(
      "adoption_listing_closed_at_when_closed",
      sql`(${table.status} IN ('adopted', 'withdrawn')) = (${table.closedAt} IS NOT NULL)`
    ),
  ]
);

export type AdoptionListingRow = typeof adoptionListing.$inferSelect;

/**
 * A photo of a listed animal: a private original in the Files module
 * (purpose `adoption_photo`, #63). Only its derived copies are ever public.
 */
export const adoptionListingPhoto = pgTable(
  "adoption_listing_photo",
  {
    id: uuid().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => adoptionListing.id, { onDelete: "cascade" }),
    /** The original upload (#63's `file_asset`); one listing photo each. */
    fileAssetId: uuid("file_asset_id").notNull().unique(),
    /** Display order, ascending; gaps are allowed. */
    position: integer().notNull(),
    altText: text("alt_text").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("adoption_listing_photo_listing_position_idx").on(
      table.listingId,
      table.position
    ),
    check(
      "adoption_listing_photo_position_not_negative",
      sql`${table.position} >= 0`
    ),
    check(
      "adoption_listing_photo_alt_text_given",
      sql`char_length(${table.altText}) > 0`
    ),
  ]
);

export type AdoptionListingPhotoRow = typeof adoptionListingPhoto.$inferSelect;
