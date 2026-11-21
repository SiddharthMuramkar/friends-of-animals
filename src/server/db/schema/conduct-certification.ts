// Conduct certification (#87): an institution's coordinator confirms, once
// per institution registration, that the competition and its judging ran
// in the school as FOA's guidelines say. The school round can't be
// finalised without it (#89). Rows are written once and never edited; the
// unique registration id is what makes it "once", since two requests at
// the same moment can't both insert.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./identity";

export const conductCertification = pgTable(
  "conduct_certification",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    /**
     * The institution's registration for one competition (#75). Its
     * foreign key comes with that table.
     */
    institutionRegistrationId: uuid("institution_registration_id")
      .notNull()
      .unique(),
    /**
     * Who certified. Null once their account is deleted: the school's
     * certification still stands, and the audit log keeps who it was.
     */
    certifiedByUserId: uuid("certified_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    certifiedAt: timestamp("certified_at", { withTimezone: true }).notNull(),
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
