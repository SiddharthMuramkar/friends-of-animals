// FOA verification of digital entries (#92). Every decision an FOA verifier
// makes on an entry that reached FOA is one row: verified, or sent back
// with a reason and a resubmission deadline. A sent-back row also records
// the resubmission, when the participant, guardian or coordinator makes
// one. The entry's status lives on the entry (entries.ts); these rows are
// the history, so a second send-back or the final verify adds a row and
// never overwrites one.
//
// Personal data (listed in src/server/modules/privacy/inventory.ts): the
// verifier's and resubmitter's user ids, and the verifier's note.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  SEND_BACK_REASON_TEXT_MAX,
  VERIFICATION_DECISIONS,
} from "../../modules/verification/domain/decide";
import { entry } from "./entries";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Both values from the start (ADR 0004, rule F2). */
export const entryVerificationDecision = pgEnum(
  "entry_verification_decision",
  VERIFICATION_DECISIONS
);

export const entryVerification = pgTable(
  "entry_verification",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    decision: entryVerificationDecision().notNull(),
    /**
     * A send-back's preset reason (SEND_BACK_REASON_CODES); text, not an
     * enum, so FOA can change the presets (HR-37) without a migration.
     */
    reasonCode: text("reason_code"),
    /** The verifier's note to whoever resubmits; required for "other". */
    reasonText: text("reason_text"),
    /** Null for seed data, or once that account is gone. */
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamptz("decided_at").notNull(),
    /** A send-back's deadline: the decision plus `entries.resubmissionDays`. */
    resubmissionDueAt: timestamptz("resubmission_due_at"),
    /** When the sent-back entry was resubmitted; null until it is. */
    resubmittedAt: timestamptz("resubmitted_at"),
    /** Who resubmitted; null until then, for seed data, or once gone. */
    resubmittedByUserId: uuid("resubmitted_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    /**
     * Whether the resubmission brought a new file. With one, the entry
     * stays sent back until that file is live.
     */
    resubmissionWithFile: boolean("resubmission_with_file"),
  },
  (table) => [
    check(
      "entry_verification_sent_back_has_deadline",
      sql`(${table.decision} = 'sent_back') = (${table.resubmissionDueAt} IS NOT NULL)`
    ),
    check(
      "entry_verification_sent_back_has_reason",
      sql`(${table.decision} = 'sent_back') = (${table.reasonCode} IS NOT NULL)`
    ),
    check(
      "entry_verification_reason_text_length",
      sql`${table.reasonText} IS NULL OR char_length(${table.reasonText}) BETWEEN 1 AND ${sql.raw(String(SEND_BACK_REASON_TEXT_MAX))}`
    ),
    check(
      "entry_verification_resubmission_complete",
      sql`(${table.resubmittedAt} IS NULL) = (${table.resubmissionWithFile} IS NULL) AND (${table.resubmittedAt} IS NULL OR ${table.decision} = 'sent_back')`
    ),
    // An entry's history, newest last.
    index("entry_verification_entry_id_decided_at_idx").on(
      table.entryId,
      table.decidedAt
    ),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("entry_verification_decided_by_user_id_idx").on(
      table.decidedByUserId
    ),
    index("entry_verification_resubmitted_by_user_id_idx").on(
      table.resubmittedByUserId
    ),
  ]
);

export type EntryVerificationRow = typeof entryVerification.$inferSelect;
