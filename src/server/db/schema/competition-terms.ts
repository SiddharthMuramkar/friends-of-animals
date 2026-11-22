// A competition's terms (#72): its fee per participation route, its award
// scheme per planned round, and the consent document versions it pins.
// Kept apart from ./competitions.ts, which #70 and #71 own.
//
// - competition_fee: one row per route the competition offers, in paise.
//   An offered route with no row has no fee set yet; 0 means free.
// - competition_award_scheme: one row per planned round (school, FOA
//   final) whose scheme or prizes differ from the default. No row means
//   ranked 1st, 2nd and 3rd with no prizes.
// - competition_consent_document: the pinned version per purpose. Consent
//   documents are never edited (#64), so the foreign key is the pin, and
//   ON DELETE RESTRICT keeps a pinned version from going.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  AWARD_ROUNDS,
  AWARD_SCHEMES,
  type Prizes,
} from "../../modules/competitions/domain/award-schemes";
import { PARTICIPATION_ROUTES } from "../../modules/competitions/domain/fees";
import { competition } from "./competitions";
import { consentDocument, consentPurposeEnum } from "./consent";
import { user } from "./identity";

/** Who pays: a person entering alone, or an institution for its students. */
export const participationRouteEnum = pgEnum(
  "participation_route",
  PARTICIPATION_ROUTES
);

export const awardSchemeEnum = pgEnum("award_scheme", AWARD_SCHEMES);

/** Planned rounds until rounds exist (#95); later rounds use foa_final's. */
export const awardRoundEnum = pgEnum("award_round", AWARD_ROUNDS);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Null for seed data, or once that user's account is gone. */
const byUser = (name: string) =>
  uuid(name).references(() => user.id, { onDelete: "set null" });

export const competitionFee = pgTable(
  "competition_fee",
  {
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    route: participationRouteEnum().notNull(),
    /** Paise. A bigint end to end, so no amount passes through a float. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    updatedByUserId: byUser("updated_by_user_id"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.competitionId, table.route] }),
    check(
      "competition_fee_amount_not_negative",
      sql`${table.amountMinor} >= 0`
    ),
    // FOA takes domestic INR only (#55).
    check("competition_fee_currency_inr", sql`${table.currency} = 'INR'`),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("competition_fee_updated_by_user_id_idx").on(table.updatedByUserId),
  ]
);

export type CompetitionFeeRow = typeof competitionFee.$inferSelect;

export const competitionAwardScheme = pgTable(
  "competition_award_scheme",
  {
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    round: awardRoundEnum().notNull(),
    scheme: awardSchemeEnum().notNull().default("ranked_123"),
    /** Trimmed prize text per band of `scheme`, checked by decideRoundAwards. */
    prizes: jsonb().$type<Prizes>().notNull().default({}),
    updatedByUserId: byUser("updated_by_user_id"),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.competitionId, table.round] }),
    check(
      "competition_award_scheme_prizes_object",
      sql`jsonb_typeof(${table.prizes}) = 'object'`
    ),
    index("competition_award_scheme_updated_by_user_id_idx").on(
      table.updatedByUserId
    ),
  ]
);

export type CompetitionAwardSchemeRow =
  typeof competitionAwardScheme.$inferSelect;

export const competitionConsentDocument = pgTable(
  "competition_consent_document",
  {
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    purpose: consentPurposeEnum().notNull(),
    /** The pinned version. Re-attaching moves it to the latest one. */
    consentDocumentId: uuid("consent_document_id")
      .notNull()
      .references(() => consentDocument.id, { onDelete: "restrict" }),
    attachedByUserId: byUser("attached_by_user_id"),
    attachedAt: timestamptz("attached_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.competitionId, table.purpose] }),
    index("competition_consent_document_consent_document_id_idx").on(
      table.consentDocumentId
    ),
    index("competition_consent_document_attached_by_user_id_idx").on(
      table.attachedByUserId
    ),
  ]
);

export type CompetitionConsentDocumentRow =
  typeof competitionConsentDocument.$inferSelect;
