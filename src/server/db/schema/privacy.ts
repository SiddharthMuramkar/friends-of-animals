// Legal holds (#114). A super admin places a hold on a person's account,
// a participant's profile or an institution when FOA must keep their
// records past retention (a claim, an inquiry). While it is in force the
// daily retention sweep skips every record about that subject and counts
// it as held. Releasing the hold lets the next run remove what has expired.
//
// A released hold stays as the record of who held what and why, until the
// releasedLegalHolds policy deletes it. The reason is free text and so
// personal data: it is in the data inventory
// (src/server/modules/privacy/inventory.ts), never in the audit log.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Actor } from "../../actor";
import type { RetentionRunSummary } from "../../modules/privacy/domain/retention-plan";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Who a hold can be about. */
export const LEGAL_HOLD_SUBJECT_TYPES = [
  "user",
  "participant_profile",
  "institution",
] as const;

export type LegalHoldSubjectType = (typeof LEGAL_HOLD_SUBJECT_TYPES)[number];

/** The most a hold's reason may say. */
export const LEGAL_HOLD_REASON_MAX = 500;

export const legalHold = pgTable(
  "legal_hold",
  {
    id: uuid().primaryKey(),
    subjectType: text("subject_type").$type<LegalHoldSubjectType>().notNull(),
    /** The held account, profile or institution, by id. */
    subjectId: uuid("subject_id").notNull(),
    reason: text().notNull(),
    /** Null once the super admin's account is deleted. */
    placedByUserId: uuid("placed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    placedAt: timestamptz("placed_at").notNull(),
    releasedByUserId: uuid("released_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Null while the hold is in force. */
    releasedAt: timestamptz("released_at"),
  },
  (table) => [
    // One hold in force per subject: placing a second is refused.
    uniqueIndex("legal_hold_one_active_per_subject")
      .on(table.subjectType, table.subjectId)
      .where(sql`${table.releasedAt} IS NULL`),
    // The sweep reads the holds in force on every run.
    index("legal_hold_active_idx")
      .on(table.subjectType)
      .where(sql`${table.releasedAt} IS NULL`),
    index("legal_hold_active_placed_at_idx")
      .on(table.placedAt, table.id)
      .where(sql`${table.releasedAt} IS NULL`),
    check(
      "legal_hold_subject_type_known",
      sql`${table.subjectType} IN ('user', 'participant_profile', 'institution')`
    ),
    check(
      "legal_hold_reason_length",
      sql`char_length(${table.reason}) BETWEEN 1 AND ${sql.raw(String(LEGAL_HOLD_REASON_MAX))}`
    ),
    check(
      "legal_hold_released_by_only_when_released",
      sql`${table.releasedByUserId} IS NULL OR ${table.releasedAt} IS NOT NULL`
    ),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("legal_hold_placed_by_user_id_idx").on(table.placedByUserId),
    index("legal_hold_released_by_user_id_idx").on(table.releasedByUserId),
  ]
);

export type LegalHold = typeof legalHold.$inferSelect;

/** Checkpoints for enforcing runs, removed when the immutable audit is written. */
export const retentionRunProgress = pgTable("retention_run_progress", {
  id: uuid().primaryKey(),
  actorProcess: text("actor_process")
    .$type<Extract<Actor, { kind: "system" }>["process"]>()
    .notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
  policies: jsonb().$type<RetentionRunSummary["policies"]>().notNull(),
});
