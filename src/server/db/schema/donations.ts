// Donations (#106): money given to FOA, and its receipts.
//
// - donor: who gave, as they gave this time: a person, or a company or
//   CSR partner with its contact person. Name and email are encrypted;
//   `email_hash` is their blind index, so a donor asking for a lost
//   receipt link is matched without storing the address readably. A
//   signed-in donor's account is linked; a guest's isn't.
// - donation: one gift. An online one (#106) is paid through a payment
//   batch of purpose `donation` (./payments.ts) and moves through the
//   machine in src/server/modules/donations/domain/donation-status.ts.
//   Recurring charges (#107) and offline entries (#108) start with their
//   own `origin`; every enum value is in the first migration (ADR 0004).
//   Never deleted: money records outlive accounts (HR-31).
// - receipt: the one receipt of a captured donation, numbered
//   `FOA-RCPT-{FY}-{000000}` gaplessly per financial year, with every
//   printed field frozen in `snapshot`. Cancelled, never deleted or
//   renumbered, when the donation is refunded in full.
// - receipt_sequence: the counter per financial year that numbers them,
//   row-locked in the capture transaction.
// - receipt_link: a 7-day link to a receipt (#55). Only the token's
//   SHA-256 is stored; a new link is a new row.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  DONATION_ORIGINS,
  DONATION_STATUSES,
} from "../../modules/donations/domain/donation-status";
import { DONOR_TYPES } from "../../modules/donations/domain/donor";
import type { ReceiptSnapshot } from "../../modules/donations/receipts/snapshot";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";
import { paymentBatch } from "./payments";
import { recurringDonation } from "./recurring-donations";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const donorTypeEnum = pgEnum("donor_type", DONOR_TYPES);
export const donationStatusEnum = pgEnum("donation_status", DONATION_STATUSES);
export const donationOriginEnum = pgEnum("donation_origin", DONATION_ORIGINS);

/** Who a receipt link was made for. */
export const RECEIPT_LINK_AUDIENCES = ["donor", "finance"] as const;

export const donor = pgTable(
  "donor",
  {
    id: uuid().primaryKey(),
    /** The signed-in account that gave; null for a guest, or once the
     * account is gone. */
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    type: donorTypeEnum().notNull(),
    /** The person's name, or an organisation's contact person. */
    name: encryptedText("name_ciphertext").notNull(),
    email: encryptedText("email_ciphertext").notNull(),
    /** Blind index of the normalised email (`donor.email`). */
    emailHash: text("email_hash").notNull(),
    /** A company's or CSR partner's name; null for a person. */
    organisationName: text("organisation_name"),
    /** Whether the organisation's name may be shown in public (the donor
     * wall, the transparency page, #110). Its receipt always carries it. */
    discloseOrganisation: boolean("disclose_organisation")
      .notNull()
      .default(false),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    check(
      "donor_organisation_matches_type",
      sql`(${table.type} = 'individual') = (${table.organisationName} IS NULL)`
    ),
    check(
      "donor_individual_discloses_nothing",
      sql`${table.type} <> 'individual' OR NOT ${table.discloseOrganisation}`
    ),
    index("donor_email_hash_idx").on(table.emailHash),
    index("donor_user_id_idx").on(table.userId),
  ]
);

export type DonorRow = typeof donor.$inferSelect;

export const donation = pgTable(
  "donation",
  {
    id: uuid().primaryKey(),
    donorId: uuid("donor_id")
      .notNull()
      .references(() => donor.id, { onDelete: "restrict" }),
    origin: donationOriginEnum().notNull(),
    status: donationStatusEnum().notNull(),
    /** Paise, a bigint end to end (#55). */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    /** The donor asked to appear on the public donor wall (#110). */
    showOnWall: boolean("show_on_wall").notNull().default(false),
    /** The name the wall shows; null while not on it, or for an
     * organisation that chose not to be named. */
    wallName: text("wall_name"),
    /** The donor declared being 18 or over, and that the money is their
     * own Indian-source money (FCRA, #55). */
    declaredAdult: boolean("declared_adult").notNull(),
    declaredIndianSource: boolean("declared_indian_source").notNull(),
    /** The payment batch an online donation is paid through. */
    paymentBatchId: uuid("payment_batch_id").references(() => paymentBatch.id, {
      onDelete: "restrict",
    }),
    /** SHA-256 of the token that lets whoever started it reach its
     * checkout and thank-you pages without an account. */
    checkoutTokenHash: text("checkout_token_hash"),
    /** The captured gateway payment; null until captured. */
    gatewayPaymentId: text("gateway_payment_id"),
    recurringDonationId: uuid("recurring_donation_id").references(
      () => recurringDonation.id,
      { onDelete: "restrict" }
    ),
    /** When a pending online donation expires unpaid. */
    expiresAt: timestamptz("expires_at"),
    capturedAt: timestamptz("captured_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("donation_gateway_payment_unique").on(table.gatewayPaymentId),
    unique("donation_payment_batch_unique").on(table.paymentBatchId),
    unique("donation_checkout_token_hash_unique").on(table.checkoutTokenHash),
    check("donation_amount_positive", sql`${table.amountMinor} > 0`),
    // FOA takes domestic INR only while FCRA is off (#55).
    check("donation_currency_inr", sql`${table.currency} = 'INR'`),
    check(
      "donation_declarations_made",
      sql`${table.declaredAdult} AND ${table.declaredIndianSource}`
    ),
    check(
      "donation_wall_name_when_shown",
      sql`${table.showOnWall} OR ${table.wallName} IS NULL`
    ),
    check(
      "donation_online_has_batch",
      sql`${table.origin} <> 'online_checkout' OR (${table.paymentBatchId} IS NOT NULL AND ${table.checkoutTokenHash} IS NOT NULL AND ${table.expiresAt} IS NOT NULL)`
    ),
    check(
      "donation_captured_at_when_kept",
      sql`${table.status} NOT IN ('captured', 'partially_refunded') OR ${table.capturedAt} IS NOT NULL`
    ),
    index("donation_donor_id_idx").on(table.donorId),
    index("donation_status_created_at_idx").on(table.status, table.createdAt),
    index("donation_created_at_idx").on(table.createdAt),
  ]
);

export type DonationRow = typeof donation.$inferSelect;

export const receipt = pgTable(
  "receipt",
  {
    id: uuid().primaryKey(),
    donationId: uuid("donation_id")
      .notNull()
      .references(() => donation.id, { onDelete: "restrict" }),
    /** The financial-year token, e.g. "2627" for April 2026 to March 2027. */
    fy: char({ length: 4 }).notNull(),
    /** Its place in the financial year, from 1, with no gaps. */
    seq: integer().notNull(),
    /** `FOA-RCPT-{fy}-{seq, six digits}`. */
    number: text().notNull(),
    issuedAt: timestamptz("issued_at").notNull(),
    /** Every printed field as issued; later changes never reach it. */
    snapshot: jsonb().$type<ReceiptSnapshot>().notNull(),
    templateVersion: smallint("template_version").notNull(),
    /** Set when the donation was refunded in full. Its number is never
     * used again. */
    cancelledAt: timestamptz("cancelled_at"),
  },
  (table) => [
    unique("receipt_donation_unique").on(table.donationId),
    unique("receipt_fy_seq_unique").on(table.fy, table.seq),
    unique("receipt_number_unique").on(table.number),
    check("receipt_seq_positive", sql`${table.seq} BETWEEN 1 AND 999999`),
  ]
);

export type ReceiptRow = typeof receipt.$inferSelect;

export const receiptSequence = pgTable(
  "receipt_sequence",
  {
    fy: char({ length: 4 }).primaryKey(),
    /** The last number given out in this financial year. */
    lastSeq: integer("last_seq").notNull(),
  },
  (table) => [
    check(
      "receipt_sequence_in_range",
      sql`${table.lastSeq} BETWEEN 0 AND 999999`
    ),
  ]
);

export const receiptLink = pgTable(
  "receipt_link",
  {
    id: uuid().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipt.id, { onDelete: "restrict" }),
    /** SHA-256 of the link's token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    /** Emailed to the donor, or handed to finance on screen. */
    issuedTo: text("issued_to", { enum: RECEIPT_LINK_AUDIENCES }).notNull(),
    /** Who asked for it; null when the platform made it, or once the
     * account is gone. */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [
    unique("receipt_link_token_hash_unique").on(table.tokenHash),
    check(
      "receipt_link_expires_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
    index("receipt_link_receipt_id_idx").on(table.receiptId),
    index("receipt_link_created_by_user_id_idx").on(table.createdByUserId),
  ]
);

export type ReceiptLinkRow = typeof receiptLink.$inferSelect;
