// The NGO directory (#127). An organisation or individual registers one
// listing; it stays private until FOA staff verify it, and staff can also
// reject, suspend and reinstate it, always with a reason. The listing is
// the organisation: `organisation_representative` grants are scoped to its
// id, and adoption listings (#129) will point at it.
//
// The address and contact phone are stored encrypted by the field cipher
// (src/server/modules/directory/cipher.ts); once #58 lands they become its
// `encryptedText` columns, which are `text` in SQL too.
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
  uuid,
} from "drizzle-orm/pg-core";

import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
} from "../../modules/directory/domain/catalogue";
import { DOCUMENT_KINDS } from "../../modules/directory/domain/documents";
import { LISTING_STATUSES } from "../../modules/directory/domain/listing-status";
import { fileAsset } from "./files";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const directoryListingType = pgEnum(
  "directory_listing_type",
  LISTING_TYPES
);

/** A new service is a new value, added in a migration of its own. */
export const directoryService = pgEnum("directory_service", DIRECTORY_SERVICES);

export const directoryListingStatus = pgEnum(
  "directory_listing_status",
  LISTING_STATUSES
);

export const directoryDocumentKind = pgEnum(
  "directory_document_kind",
  DOCUMENT_KINDS
);

export const directoryListing = pgTable(
  "directory_listing",
  {
    /** UUIDv7; also the scope id of the listing's representatives. */
    id: uuid().primaryKey(),
    /** The public address, /ngos/<slug>. Made once, never changed. */
    slug: text().notNull().unique("directory_listing_slug_unique"),
    type: directoryListingType().notNull(),
    name: text().notNull(),
    /** Plain text until #111's sanitiser allows rich text. */
    description: text().notNull(),
    /** In catalogue order; at least one. */
    services: directoryService().array().notNull(),
    /** Never public: the public page shows city, state and pin code only. */
    addressCiphertext: text("address_ciphertext").notNull(),
    city: text().notNull(),
    state: text().notNull(),
    pinCode: text("pin_code").notNull(),
    /** E.164, encrypted. */
    contactPhoneCiphertext: text("contact_phone_ciphertext").notNull(),
    contactEmail: text("contact_email"),
    website: text(),
    /** The contacts the listing chose to show: phone, email, website. */
    publicContactFields: text("public_contact_fields").array().notNull(),
    status: directoryListingStatus().notNull(),
    /** Why staff (or the listing's people) last changed its status. */
    statusReason: text("status_reason"),
    /** Who last changed the status; null once their account is gone. */
    statusChangedByUserId: uuid("status_changed_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    statusChangedAt: timestamptz("status_changed_at").notNull(),
    /**
     * Who registered it. Restricted: erasing an account must deal with its
     * listings first.
     */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
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
      sql`${table.publicContactFields} <@ array['phone', 'email', 'website']::text[]`
    ),
    check(
      "directory_listing_status_reason_length",
      sql`char_length(${table.statusReason}) <= 1000`
    ),
    // The staff queue lists one status, oldest first.
    index("directory_listing_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id
    ),
    index("directory_listing_owner_user_id_idx").on(table.ownerUserId),
    index("directory_listing_status_changed_by_idx").on(
      table.statusChangedByUserId
    ),
  ]
);

export type DirectoryListingRow = typeof directoryListing.$inferSelect;

/** Proof a listing uploaded for verification: private files staff open. */
export const directoryListingDocument = pgTable(
  "directory_listing_document",
  {
    id: uuid().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => directoryListing.id, { onDelete: "cascade" }),
    /** A file of purpose directory_document, uploaded by the listing. */
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .unique("directory_listing_document_file_unique")
      .references(() => fileAsset.id, { onDelete: "restrict" }),
    kind: directoryDocumentKind().notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("directory_listing_document_listing_idx").on(
      table.listingId,
      table.createdAt
    ),
  ]
);

export type DirectoryListingDocumentRow =
  typeof directoryListingDocument.$inferSelect;
