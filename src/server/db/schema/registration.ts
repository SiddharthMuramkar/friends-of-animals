// Registration (#75). An institution registers for a competition once; the
// registration gets a reference made of the competition's code, "I" and
// five random Crockford base32 symbols (PAWS27-I-Q2W9R), which its
// coordinators and FOA quote. Enrolling students against a registration
// (#75b), fees (#77) and the individual route (#78) add their tables here.
//
// Personal data: `registered_by`, the coordinator or authorised person who
// registered; the data inventory lists it
// (src/server/modules/privacy/inventory.ts).
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

import { INSTITUTION_REGISTRATION_STATUSES } from "../../modules/registration/domain/institution-registration";
import { competition } from "./competitions";
import { user } from "./identity";
import { institution } from "./institutions";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Active only, for now. Withdrawing (#77) and cancelling (#80) append
 * their values in migrations of their own (rule F2).
 */
export const institutionRegistrationStatusEnum = pgEnum(
  "institution_registration_status",
  INSTITUTION_REGISTRATION_STATUSES
);

/** The constraint a second registration of the same pair runs into. */
export const INSTITUTION_REGISTRATION_PAIR_UNIQUE =
  "institution_registration_institution_competition_unique";

/** The constraint `withUniqueCode` retries on when a reference is taken. */
export const INSTITUTION_REGISTRATION_REFERENCE_UNIQUE =
  "institution_registration_reference_unique";

export const institutionRegistration = pgTable(
  "institution_registration",
  {
    id: uuid().primaryKey(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institution.id),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    /** `{competition code}-I-{5 Crockford base32}`, e.g. PAWS27-I-Q2W9R. */
    reference: text().notNull(),
    status: institutionRegistrationStatusEnum().notNull().default("active"),
    /**
     * The coordinator or authorised person who registered; null for seed
     * data, or once their account is gone.
     */
    registeredBy: uuid("registered_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One registration per institution and competition.
    unique(INSTITUTION_REGISTRATION_PAIR_UNIQUE).on(
      table.institutionId,
      table.competitionId
    ),
    unique(INSTITUTION_REGISTRATION_REFERENCE_UNIQUE).on(table.reference),
    check(
      "institution_registration_reference_format",
      sql`${table.reference} ~ '^[A-Z]{3,6}[0-9]{2}-I-[0-9A-HJKMNP-TV-Z]{5}$'`
    ),
    // FOA lists a competition's registrations (#77, #87).
    index("institution_registration_competition_id_idx").on(
      table.competitionId
    ),
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("institution_registration_registered_by_idx").on(table.registeredBy),
  ]
);

export type InstitutionRegistration =
  typeof institutionRegistration.$inferSelect;
