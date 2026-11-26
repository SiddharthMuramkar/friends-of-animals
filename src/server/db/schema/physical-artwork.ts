// Physical artwork (#93): the original work FOA asks a verified entry to
// courier in, one row per entry. The status enum holds every value the
// module will need (src/server/modules/physical-artwork/domain/status.ts),
// and no DDL here names one of them, so later tickets add moves without
// touching the enum.
//
// Requesting snapshots the packaging instructions, who pays shipping and
// FOA's address, so a later settings change never rewrites what a sender
// was told. The sender records the courier and tracking number; staff
// record receipt.
//
// The row refers to its verified entry and registration; deleting the entry
// through privacy erasure removes the dependent artwork record.
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
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { PHYSICAL_ARTWORK_STATUSES } from "../../modules/physical-artwork/domain/status";
import { user } from "./identity";
import { competition } from "./competitions";
import { entry } from "./entries";
import { registration, institutionRegistration } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const physicalArtworkStatus = pgEnum(
  "physical_artwork_status",
  PHYSICAL_ARTWORK_STATUSES
);

export const physicalArtwork = pgTable(
  "physical_artwork",
  {
    /** UUIDv7. */
    id: uuid().primaryKey(),
    /** One artwork per entry. */
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    /** The Artwork ID, such as `PAWS26-A-8H3TZ0`. */
    artworkCode: text("artwork_code").notNull(),
    status: physicalArtworkStatus().notNull(),
    /** Set on the school route: that registration's coordinators send it. */
    institutionRegistrationId: uuid("institution_registration_id").references(
      () => institutionRegistration.id
    ),
    /** The participant's registration; on the individual route, the sender. */
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id),
    /** Null once the requesting staff member's account is gone. */
    requestedBy: uuid("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamptz("requested_at").notNull(),
    /** 23:59:59 IST on the last day to dispatch. */
    dispatchDeadline: timestamptz("dispatch_deadline").notNull(),
    packagingInstructions: text("packaging_instructions").notNull(),
    /** Who pays the courier: `foa` or `sender`. */
    shippingPayer: text("shipping_payer").notNull(),
    facilityAddress: text("facility_address").notNull(),
    courierName: text("courier_name"),
    /** Stored without spaces, upper case. */
    trackingNumber: text("tracking_number"),
    /** Null until dispatch, or once the sender's account is gone. */
    dispatchedBy: uuid("dispatched_by").references(() => user.id, {
      onDelete: "set null",
    }),
    dispatchedAt: timestamptz("dispatched_at"),
    /** Null until receipt, or once the staff member's account is gone. */
    receivedBy: uuid("received_by").references(() => user.id, {
      onDelete: "set null",
    }),
    receivedAt: timestamptz("received_at"),
    storageLocation: text("storage_location"),
    retainedAt: timestamptz("retained_at"),
  },
  (table) => [
    unique("physical_artwork_entry_id_key").on(table.entryId),
    unique("physical_artwork_artwork_code_key").on(table.artworkCode),
    check(
      "physical_artwork_code_format",
      sql`${table.artworkCode} ~ '^[A-Z]{3,6}[0-9]{2}-A-[0-9A-HJKMNP-TV-Z]{6}$'`
    ),
    check(
      "physical_artwork_shipping_payer",
      sql`${table.shippingPayer} IN ('foa', 'sender')`
    ),
    check(
      "physical_artwork_dispatch_recorded_together",
      sql`(${table.courierName} IS NULL) = (${table.dispatchedAt} IS NULL) AND (${table.trackingNumber} IS NULL) = (${table.dispatchedAt} IS NULL)`
    ),
    // The staff board lists one competition's artworks by status.
    index("physical_artwork_competition_status_idx").on(
      table.competitionId,
      table.status
    ),
    // Staff find a parcel by the tracking number on its label.
    index("physical_artwork_tracking_number_idx").on(table.trackingNumber),
    // Senders list the artworks they owe.
    index("physical_artwork_institution_registration_id_idx").on(
      table.institutionRegistrationId
    ),
    index("physical_artwork_registration_id_idx").on(table.registrationId),
  ]
);

export type PhysicalArtworkRow = typeof physicalArtwork.$inferSelect;
