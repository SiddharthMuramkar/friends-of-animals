// Adoption listings (#129). A verified directory listing (#127) lists an
// animal for adoption: who it is, its age as a birth month (never an age,
// which goes stale), its health and vaccination notes, the adoption
// conditions, and where it is. Its photos are private files of purpose
// adoption_photo; the public sees only their resized copies, and only
// while the animal and its directory listing are public.
//
// Applications and the coordinator's workflow (#130) build on these rows.
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ADOPTION_SPECIES,
  ANIMAL_SEXES,
  ANIMAL_SIZES,
} from "../../modules/adoption/domain/details";
import { ADOPTION_LISTING_STATUSES } from "../../modules/adoption/domain/status";
import { directoryListing } from "./directory";
import { fileAsset } from "./files";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Every status from the start (ADR 0004); #130 adds moves, not values. */
export const adoptionListingStatus = pgEnum(
  "adoption_listing_status",
  ADOPTION_LISTING_STATUSES
);

export const adoptionSpecies = pgEnum("adoption_species", ADOPTION_SPECIES);
export const animalSex = pgEnum("animal_sex", ANIMAL_SEXES);
export const animalSize = pgEnum("animal_size", ANIMAL_SIZES);

/** The constraint a slug clash breaks; creating takes the next candidate. */
export const ADOPTION_LISTING_SLUG_UNIQUE = "adoption_listing_slug_unique";

export const adoptionListing = pgTable(
  "adoption_listing",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    /** The organisation (or individual rescuer) offering the animal. */
    directoryListingId: uuid("directory_listing_id")
      .notNull()
      .references(() => directoryListing.id, { onDelete: "restrict" }),
    /** The public address, /adopt/<slug>. Made once, never changed. */
    slug: text().notNull(),
    name: text().notNull(),
    species: adoptionSpecies().notNull(),
    breed: text(),
    sex: animalSex().notNull(),
    /** null: not given (a bird, say). */
    size: animalSize(),
    colour: text(),
    /** The first of the estimated birth month, in India. Never an age. */
    birthMonth: date("birth_month", { mode: "string" }).notNull(),
    /** null: not known. */
    sterilised: boolean(),
    /** Plain text, line breaks kept. */
    about: text(),
    healthNotes: text("health_notes"),
    vaccinationNotes: text("vaccination_notes"),
    conditions: text().notNull(),
    /** A key of INDIAN_STATES. */
    state: text().notNull(),
    city: text().notNull(),
    /** The city normalised and lower-cased, for the browse filter. */
    cityKey: text("city_key").notNull(),
    pinCode: text("pin_code").notNull(),
    status: adoptionListingStatus().notNull(),
    /** When it was first published; browse orders by it. */
    publishedAt: timestamptz("published_at"),
    /** When it was adopted or withdrawn. */
    closedAt: timestamptz("closed_at"),
    /** The representative who wrote it; null once their account is gone. */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex(ADOPTION_LISTING_SLUG_UNIQUE).on(table.slug),
    check(
      "adoption_listing_pin_code_format",
      sql`${table.pinCode} ~ '^[1-9][0-9]{5}$'`
    ),
    check(
      "adoption_listing_birth_month_first",
      sql`extract(day from ${table.birthMonth}) = 1`
    ),
    // Anything the public has seen was published at some point.
    check(
      "adoption_listing_published_at_matches_status",
      sql`${table.status} NOT IN ('published', 'on_hold', 'adopted') OR ${table.publishedAt} IS NOT NULL`
    ),
    check(
      "adoption_listing_closed_at_matches_status",
      sql`(${table.status} IN ('adopted', 'withdrawn')) = (${table.closedAt} IS NOT NULL)`
    ),
    // Browse: published animals, newest first, keyset pages.
    index("adoption_listing_status_published_idx").on(
      table.status,
      table.publishedAt.desc(),
      table.id.desc()
    ),
    index("adoption_listing_directory_listing_idx").on(
      table.directoryListingId,
      table.createdAt
    ),
    // Deleting an account sets this to null; the index keeps that quick.
    index("adoption_listing_created_by_idx").on(table.createdByUserId),
  ]
);

export type AdoptionListingRow = typeof adoptionListing.$inferSelect;

/**
 * A photo of the animal: a private file of purpose adoption_photo, its
 * text alternative and its place in the gallery. The file's own row says
 * who uploaded it and how far its scan got; file_processing says whether
 * its resized copies are ready.
 */
export const adoptionListingPhoto = pgTable(
  "adoption_listing_photo",
  {
    id: uuid().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => adoptionListing.id, { onDelete: "cascade" }),
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    /** 1-based; the first ready photo is the cover. */
    position: integer().notNull(),
    altText: text("alt_text").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("adoption_listing_photo_file_unique").on(table.fileAssetId),
    index("adoption_listing_photo_listing_idx").on(
      table.listingId,
      table.position
    ),
    check(
      "adoption_listing_photo_position_positive",
      sql`${table.position} > 0`
    ),
  ]
);

export type AdoptionListingPhotoRow = typeof adoptionListingPhoto.$inferSelect;
