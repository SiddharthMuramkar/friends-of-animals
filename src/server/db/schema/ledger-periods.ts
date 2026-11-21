// Ledger periods and the two-approver rule (#109).
//
// `ledger_period` holds one row per IST month the ledger knows about,
// `YYYY-MM`. Locked months always form a prefix: the latest locked month is
// the lock line, and nothing posts on or before it (src/server/modules/
// ledger/periods). `finance_approval` holds money operations that wait for
// a second, different finance user (src/server/modules/ledger/approvals).
//
// People are referenced without ON DELETE: these are financial records,
// kept for the legal retention floor, so an account that locked a month or
// approved an entry is anonymised, never deleted, while they stand.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { FINANCE_APPROVAL_STATUSES } from "../../modules/ledger/approvals/domain/approval";
import { LEDGER_PERIOD_STATUSES } from "../../modules/ledger/periods/domain/period-status";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Both values exist from the first migration (no value is ever added). */
export const ledgerPeriodStatus = pgEnum(
  "ledger_period_status",
  LEDGER_PERIOD_STATUSES
);

/** All five values exist from the first migration. */
export const financeApprovalStatus = pgEnum(
  "finance_approval_status",
  FINANCE_APPROVAL_STATUSES
);

/** One IST calendar month of the ledger. */
export const ledgerPeriod = pgTable(
  "ledger_period",
  {
    /** `YYYY-MM`, the month in India. */
    month: text().primaryKey(),
    status: ledgerPeriodStatus().notNull().default("open"),
    /** Set while locked: when, and by the finance user who approved it. */
    lockedAt: timestamptz("locked_at"),
    lockedByUserId: uuid("locked_by_user_id").references(() => user.id),
    /** The latest unlock, kept after the month locks again. */
    lastUnlockedAt: timestamptz("last_unlocked_at"),
    lastUnlockedByUserId: uuid("last_unlocked_by_user_id").references(
      () => user.id
    ),
    lastUnlockReason: text("last_unlock_reason"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    check(
      "ledger_period_month_format",
      sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
    ),
    check(
      "ledger_period_locked_fields_match_status",
      sql`(${table.status} = 'locked') = (${table.lockedAt} IS NOT NULL AND ${table.lockedByUserId} IS NOT NULL)`
    ),
    check(
      "ledger_period_unlock_fields_together",
      sql`(${table.lastUnlockedAt} IS NULL) = (${table.lastUnlockedByUserId} IS NULL) AND (${table.lastUnlockedAt} IS NULL) = (${table.lastUnlockReason} IS NULL)`
    ),
  ]
);

export type LedgerPeriodRow = typeof ledgerPeriod.$inferSelect;

/**
 * A money operation waiting for a second finance user. `operation` is text
 * checked against the operation registry, not an enum, so a later money
 * operation joins without a migration. `payload` holds what the operation
 * needs to run (ids, months, amounts, finance's own narration); audit
 * entries and outbox events about a request carry its id and status only.
 */
export const financeApproval = pgTable(
  "finance_approval",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    operation: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: financeApprovalStatus().notNull().default("pending"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => user.id),
    requestedAt: timestamptz("requested_at").notNull(),
    /**
     * Who approved or rejected (never the requester), or the requester who
     * cancelled; null while pending and when the request expired.
     */
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id),
    decidedAt: timestamptz("decided_at"),
    /** Why it was rejected. */
    decisionReason: text("decision_reason"),
    /**
     * The posting an approved manual entry made. The foreign key to
     * ledger_posting arrives with the ledger tables (#105).
     */
    executedPostingId: uuid("executed_posting_id"),
  },
  (table) => [
    // Separation of duties, in the database too: an approval or rejection
    // is by someone else, a cancellation by the requester, an expiry by
    // the platform.
    check(
      "finance_approval_decision_matches_status",
      sql`CASE ${table.status}
        WHEN 'pending' THEN ${table.decidedAt} IS NULL AND ${table.decidedByUserId} IS NULL
        WHEN 'approved' THEN ${table.decidedAt} IS NOT NULL AND ${table.decidedByUserId} IS NOT NULL AND ${table.decidedByUserId} <> ${table.requestedByUserId}
        WHEN 'rejected' THEN ${table.decidedAt} IS NOT NULL AND ${table.decidedByUserId} IS NOT NULL AND ${table.decidedByUserId} <> ${table.requestedByUserId}
        WHEN 'cancelled' THEN ${table.decidedAt} IS NOT NULL AND ${table.decidedByUserId} = ${table.requestedByUserId}
        WHEN 'expired' THEN ${table.decidedAt} IS NOT NULL AND ${table.decidedByUserId} IS NULL
      END`
    ),
    check(
      "finance_approval_reason_only_when_rejected",
      sql`(${table.status} = 'rejected') = (${table.decisionReason} IS NOT NULL AND btrim(${table.decisionReason}) <> '')`
    ),
    check(
      "finance_approval_posting_only_when_approved",
      sql`${table.executedPostingId} IS NULL OR ${table.status} = 'approved'`
    ),
    // The approvals screen and the expiry job read pending requests by age.
    index("finance_approval_pending_requested_at_idx")
      .on(table.requestedAt)
      .where(sql`${table.status} = 'pending'`),
  ]
);

export type FinanceApprovalRow = typeof financeApproval.$inferSelect;
