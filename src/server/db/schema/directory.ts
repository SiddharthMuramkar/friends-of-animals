// The NGO directory (#127). An animal-welfare organisation or an
// individual (an independent rescuer, a foster caregiver) registers a
// listing; it stays private until FOA staff verify it, and staff can also
// reject, suspend and reinstate it, always with a reason. The listing is
// the organisation: `organisation_representative` grants are scoped to its
// id, and adoption listings (#129) will point at it.
//
// The address, contact phone and contact email are encrypted with the
// field cipher: an individual's listing holds their home and their own
// number. City, state and pin code stay plain, because the public page
// shows them and search by distance (#128) reads the pin code.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
} from "../../modules/directory/domain/catalogue";
import { DOCUMENT_KINDS } from "../../modules/directory/domain/documents";
import { LISTING_STATUSES } from "../../modules/directory/domain/listing-status";
import { encryptedText } from "../types/encrypted-text";
import { fileAsset } from "./files";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const directoryListingType = pgEnum(
  "directory_listing_type",
  LISTING_TYPES
);

/** A new service is a new value, added in a migration of its own (F2). */
export const directoryService = pgEnum("directory_service", DIRECTORY_SERVICES);

/** Every status from the start (ADR 0004). */
export const directoryListingStatus = pgEnum(
  "directory_listing_status",
  LISTING_STATUSES
);

export const directoryDocumentKind = pgEnum(
  "directory_document_kind",
  DOCUMENT_KINDS
);

/** The constraint a slug clash breaks; registering retries the next one. */
export const DIRECTORY_LISTING_SLUG_UNIQUE = "directory_listing_slug_unique";

const PUBLIC_CONTACTS = sql.raw(
  `array[${PUBLIC_CONTACT_FIELDS.map((field) => `'${field}'`).join(", ")}]::text[]`
);

export const directoryListing = pgTable(
  "directory_listing",
  {
    /** UUIDv7; also the scope id of the listing's representatives. */
    id: uuid().primaryKey(),
    /** The public address, /ngos/<slug>. Made once, never changed. */
    slug: text().notNull(),
    type: directoryListingType().notNull(),
    name: text().notNull(),
    /** Plain text until #111's sanitiser allows rich text. */
    description: text().notNull(),
    /** In catalogue order; at least one. #128 searches by these. */
    services: directoryService().array().notNull(),
    /** Never public: the public page shows city, state and pin code only. */
    addressCiphertext: encryptedText("address_ciphertext").notNull(),
    city: text().notNull(),
    state: text().notNull(),
    /** An Indian PIN code; #128 measures distance from it. */
    pinCode: text("pin_code").notNull(),
    /** E.164, encrypted for purpose "directory_listing.contact_phone". */
    contactPhoneCiphertext: encryptedText(
      "contact_phone_ciphertext"
    ).notNull(),
    /** Lower-cased, encrypted for "directory_listing.contact_email". */
    contactEmailCiphertext: encryptedText("contact_email_ciphertext"),
    website: text(),
    /** The contacts the listing chose to show: phone, email, website. */
    publicContactFields: text("public_contact_fields").array().notNull(),
    status: directoryListingStatus().notNull(),
    /** Why its status last changed: staff's reason, or the withdrawal's. */
    statusReason: text("status_reason"),
    statusChangedAt: timestamptz("status_changed_at").notNull(),
    /** Who last changed the status; null once their account is gone. */
    statusChangedByUserId: uuid("status_changed_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    /**
     * When FOA first verified it. From then on only the representative
     * role acts for it, even after it goes back to review.
     */
    verifiedAt: timestamptz("verified_at"),
    /**
     * Who registered it. No ON DELETE: erasing an account must deal with
     * its listings first (#115).
     */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex(DIRECTORY_LISTING_SLUG_UNIQUE).on(table.slug),
    check(
      "directory_listing_services_present",
      sql`cardinality(${table.services}) > 0`
    ),
    check(
      "directory_listing_pin_code_format",
      sql`${table.pinCode} ~ '^[1-9][0-9]{5}$'`
    ),
    check(
      "directory_listing_public_contact_fields_known",
      sql`${table.publicContactFields} <@ ${PUBLIC_CONTACTS}`
    ),
    check(
      "directory_listing_status_reason_length",
      sql`char_length(${table.statusReason}) <= 1000`
    ),
    // A verified or suspended listing has been verified at least once.
    check(
      "directory_listing_verified_at_matches_status",
      sql`${table.status} NOT IN ('verified', 'suspended') OR ${table.verifiedAt} IS NOT NULL`
    ),
    // One open listing per person who registers: after a rejection or a
    // withdrawal they may register again.
    uniqueIndex("directory_listing_one_open_per_owner")
      .on(table.ownerUserId)
      .where(
        sql`${table.status} IN ('pending_verification', 'verified', 'suspended')`
      ),
    // The staff queue lists one status, oldest first.
    index("directory_listing_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id
    ),
    index("directory_listing_owner_user_id_idx").on(table.ownerUserId),
    // Deleting a staff account sets this to null; the index keeps that
    // from scanning.
    index("directory_listing_status_changed_by_idx").on(
      table.statusChangedByUserId
    ),
  ]
);

export type DirectoryListingRow = typeof directoryListing.$inferSelect;

/**
 * Proof a listing uploaded for FOA's verification: a private file of
 * purpose directory_document that only staff open. The file's own row
 * says who uploaded it and how far its scan got; this one says what it is
 * and whose. It goes with its file.
 */
export const directoryListingDocument = pgTable(
  "directory_listing_document",
  {
    id: uuid().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => directoryListing.id, { onDelete: "cascade" }),
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    kind: directoryDocumentKind().notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("directory_listing_document_file_unique").on(
      table.fileAssetId
    ),
    index("directory_listing_document_listing_idx").on(
      table.listingId,
      table.createdAt
    ),
  ]
);

export type DirectoryListingDocumentRow =
  typeof directoryListingDocument.$inferSelect;
