// Conduct certification (#87): once per institution registration, one of
// the institution's coordinators (or its authorised person) confirms that
// the competition was run in the school according to FOA's guidelines.
// Finalising the school round (#89) requires it. A row is written once and
// never changed: the unique registration id is what makes it "once", so
// two coordinators certifying at the same moment can't both insert. There
// is no revoking in M2.
//
// Personal data: `certified_by_user_id` (the data inventory lists it, in
// src/server/modules/privacy/inventory.ts). Who certified, with their IP and
// user agent, is also in the audit log.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./identity";
import { institutionRegistration } from "./registration";

/** The constraint a second certification of one registration runs into. */
export const CONDUCT_CERTIFICATION_REGISTRATION_UNIQUE =
  "conduct_certification_institution_registration_unique";

export const conductCertification = pgTable(
  "conduct_certification",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    institutionRegistrationId: uuid("institution_registration_id")
      .notNull()
      .unique(CONDUCT_CERTIFICATION_REGISTRATION_UNIQUE)
      .references(() => institutionRegistration.id),
    /**
     * Who certified. Null once their account is deleted: the school's
     * certification still stands, and the audit log keeps who it was.
     */
    certifiedByUserId: uuid("certified_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    certifiedAt: timestamp("certified_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** The version of the statement wording the coordinator confirmed. */
    statementVersion: text("statement_version").notNull(),
  },
  (table) => [
    // Deleting a user sets this to null; the index keeps that from scanning.
    index("conduct_certification_certified_by_user_id_idx").on(
      table.certifiedByUserId
    ),
  ]
);

export type ConductCertificationRow = typeof conductCertification.$inferSelect;
