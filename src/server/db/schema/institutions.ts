// Institutions (#73): schools, colleges and universities that take part
// through FOA. The authorised person (`created_by`) registers one; FOA
// staff verify, reject or suspend it. The first verification gives it its
// Institution ID (`FOA-I-` and 5 Crockford base32 symbols,
// src/server/modules/codes) and the authorised person the institution_admin
// role scoped to it.
//
// The principal's email and phone are encrypted with the field cipher. The
// institution's own address and contact details, and the principal's name,
// are stored plain; the data inventory lists all of them
// (src/server/modules/privacy/inventory.ts).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  INSTITUTION_TYPES,
  MAX_EXPECTED_PARTICIPANTS,
} from "../../modules/institutions/domain/registration";
import { INSTITUTION_STATUSES } from "../../modules/institutions/domain/status";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";

export const institutionStatusEnum = pgEnum(
  "institution_status",
  INSTITUTION_STATUSES
);

export const institutionTypeEnum = pgEnum(
  "institution_type",
  INSTITUTION_TYPES
);

/** The constraint `withUniqueCode` retries on when a code is taken. */
export const INSTITUTION_CODE_UNIQUE = "institution_institution_code_unique";

export const institution = pgTable(
  "institution",
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    type: institutionTypeEnum().notNull(),
    address: text().notNull(),
    /** An Indian PIN code: six digits, not starting with 0. */
    pinCode: text("pin_code").notNull(),
    city: text().notNull(),
    state: text().notNull(),
    country: text().notNull(),
    /** The institution's office, lower-cased. */
    contactEmail: text("contact_email").notNull(),
    /** E.164, e.g. "+919876543210". */
    contactPhone: text("contact_phone").notNull(),
    principalName: text("principal_name").notNull(),
    /** Lower-cased, encrypted for purpose "institution.principal_email". */
    principalEmailCiphertext: encryptedText(
      "principal_email_ciphertext"
    ).notNull(),
    /** E.164, encrypted for purpose "institution.principal_phone". */
    principalPhoneCiphertext: encryptedText(
      "principal_phone_ciphertext"
    ).notNull(),
    expectedParticipants: integer("expected_participants").notNull(),
    status: institutionStatusEnum().notNull().default("pending_verification"),
    /** Why staff made the latest decision; null until the first one. */
    statusReason: text("status_reason"),
    /** The Institution ID, from the first verification on. */
    institutionCode: text("institution_code"),
    /** The authorised person, who registered it. */
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id),
    /** Who verified it first; null once their account is gone. */
    verifiedBy: uuid("verified_by").references(() => user.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique(INSTITUTION_CODE_UNIQUE).on(table.institutionCode),
    check(
      "institution_pin_code_format",
      sql`${table.pinCode} ~ '^[1-9][0-9]{5}$'`
    ),
    check(
      "institution_expected_participants_range",
      sql`${table.expectedParticipants} BETWEEN 1 AND ${sql.raw(String(MAX_EXPECTED_PARTICIPANTS))}`
    ),
    // Verified and suspended institutions hold their Institution ID, and
    // only they: rejection happens before any verification.
    check(
      "institution_code_matches_status",
      sql`(${table.institutionCode} IS NOT NULL) = (${table.status} IN ('verified', 'suspended'))`
    ),
    check(
      "institution_verified_at_matches_code",
      sql`(${table.verifiedAt} IS NOT NULL) = (${table.institutionCode} IS NOT NULL)`
    ),
    // Every decision has a reason; a registration waiting for its first
    // decision has none.
    check(
      "institution_reason_matches_status",
      sql`(${table.statusReason} IS NULL) = (${table.status} = 'pending_verification')`
    ),
    // One open registration per authorised person: after a rejection they
    // may register again.
    uniqueIndex("institution_one_open_per_creator")
      .on(table.createdBy)
      .where(sql`${table.status} <> 'rejected'`),
    // The staff queue lists one status, oldest first.
    index("institution_status_created_at_idx").on(
      table.status,
      table.createdAt
    ),
    index("institution_created_by_idx").on(table.createdBy),
    // Deleting a staff account sets this to null; the index keeps that
    // from scanning.
    index("institution_verified_by_idx").on(table.verifiedBy),
  ]
);

export type Institution = typeof institution.$inferSelect;
