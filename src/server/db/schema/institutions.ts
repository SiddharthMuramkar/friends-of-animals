// PROVISIONAL: a minimal stand-in for #73's `institution` table, so #74
// (coordinators) can build ahead of #73. It holds only what #74 reads: the
// name and the status. When #73's branch merges, its own
// src/server/db/schema/institutions.ts replaces this file whole, and #74's
// migration is regenerated without this table.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { INSTITUTION_STATUSES } from "../../modules/institutions/domain/status";

export const institutionStatus = pgEnum(
  "institution_status",
  INSTITUTION_STATUSES
);

export const institution = pgTable("institution", {
  id: uuid().primaryKey(),
  name: text().notNull(),
  status: institutionStatus().notNull().default("pending_verification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export type Institution = typeof institution.$inferSelect;
