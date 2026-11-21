// The ledger (#105): FOA's double-entry books. Every rupee that moves is
// one posting of two or more lines. Each line moves a positive amount onto
// one side of one account, and a posting's debits equal its credits.
//
// Postings are append-only: a mistake is corrected by a reversal or a new
// entry, never by an edit. drizzle/*_105_ledger_guards.sql backs that with
// triggers: UPDATE, DELETE and TRUNCATE on postings and lines fail, and at
// COMMIT every posting must have at least two lines that balance. The same
// file inserts the seeded chart of accounts (SEEDED_ACCOUNTS).
//
// Amounts are bigint paise in INR (#55). `source_type` is a text registry
// (LEDGER_SOURCE_TYPES), not an enum, so later sources (donations, auction
// proceeds) need no enum migration.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ACCOUNT_KINDS,
  PUBLIC_GROUPS,
} from "../../modules/ledger/domain/chart";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const ledgerAccountKind = pgEnum("ledger_account_kind", ACCOUNT_KINDS);

/** One account of the chart. Finance's "categories" are the income and expense ones. */
export const ledgerAccount = pgTable(
  "ledger_account",
  {
    /** UUIDv7; the seeded chart has fixed ids. */
    id: uuid().primaryKey(),
    /** Four digits. The first is the kind: 1 asset, 2 liability, 3 equity, 4 income, 5 expense. */
    code: text().notNull(),
    name: text().notNull(),
    kind: ledgerAccountKind().notNull(),
    /** Posting rules write to it, so nobody may change or deactivate it. */
    isSystem: boolean("is_system").notNull().default(false),
    /** An inactive account takes no new manual lines; its history stays. */
    isActive: boolean("is_active").notNull().default(true),
    /** What the transparency page (#110) shows; null shows the name. */
    publicLabel: text("public_label"),
    /** How #110 groups it. Income and expense accounts only. */
    publicGroup: text("public_group", { enum: PUBLIC_GROUPS }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("ledger_account_code_key").on(table.code),
    check(
      "ledger_account_code_matches_kind",
      sql`${table.code} ~ '^[0-9]{4}$' AND left(${table.code}, 1) = CASE ${table.kind} WHEN 'asset' THEN '1' WHEN 'liability' THEN '2' WHEN 'equity' THEN '3' WHEN 'income' THEN '4' WHEN 'expense' THEN '5' END`
    ),
    check(
      "ledger_account_public_group_for_categories",
      sql`(${table.kind} IN ('income', 'expense')) = (${table.publicGroup} IS NOT NULL)`
    ),
  ]
);

/** One journal entry: where it came from, when, and why. Its lines hold the money. */
export const ledgerPosting = pgTable(
  "ledger_posting",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    /** The journal number finance and URLs use. Rolled-back inserts leave gaps. */
    seq: bigint({ mode: "bigint" }).generatedAlwaysAsIdentity().notNull(),
    /** LEDGER_SOURCE_TYPES. With `source_id`, one posting per source. */
    sourceType: text("source_type").notNull(),
    /** The payment, refund or posting it came from (a manual entry's own id). */
    sourceId: text("source_id").notNull(),
    /** When the money moved: a capture, a refund, the day of a manual entry. */
    occurredAt: timestamptz("occurred_at").notNull(),
    /** The IST calendar month of `occurred_at`, `YYYY-MM`. */
    periodMonth: text("period_month").notNull(),
    /** May name people (a manual entry's counterparty): never copied to the audit log. */
    description: text().notNull(),
    /** The competition the money belongs to, when it belongs to one. */
    competitionId: uuid("competition_id"),
    /** The posting this one undoes: a refund's capture, a reversal's manual entry. */
    reversalOfPostingId: uuid("reversal_of_posting_id").references(
      (): AnyPgColumn => ledgerPosting.id
    ),
    /**
     * Who entered it; null when the platform posted it. No foreign key,
     * as in the audit log: the table refuses the update ON DELETE SET NULL
     * would make.
     */
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    unique("ledger_posting_seq_key").on(table.seq),
    unique("ledger_posting_source_key").on(table.sourceType, table.sourceId),
    check(
      "ledger_posting_period_month_format",
      sql`${table.periodMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
    ),
    check(
      "ledger_posting_description_length",
      sql`char_length(${table.description}) BETWEEN 1 AND 500`
    ),
    // The postings screen filters by date and lists newest first.
    index("ledger_posting_occurred_at_idx").on(table.occurredAt),
    index("ledger_posting_reversal_of_posting_id_idx").on(
      table.reversalOfPostingId
    ),
  ]
);

/** One side of a posting: a positive amount, debited or credited to one account. */
export const ledgerLine = pgTable(
  "ledger_line",
  {
    id: uuid().primaryKey(),
    postingId: uuid("posting_id")
      .notNull()
      .references(() => ledgerPosting.id),
    /** Its place in the posting, from 1, in the order it was entered. */
    lineNo: smallint("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccount.id),
    /** Paise. Exactly one of debit and credit is set (above zero). */
    debitMinor: bigint("debit_minor", { mode: "bigint" }).notNull(),
    creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull(),
    currency: char({ length: 3 }).notNull().default("INR"),
    /** May name people: never copied to the audit log. */
    memo: text(),
  },
  (table) => [
    unique("ledger_line_posting_id_line_no_key").on(
      table.postingId,
      table.lineNo
    ),
    check("ledger_line_line_no_positive", sql`${table.lineNo} >= 1`),
    check(
      "ledger_line_one_side",
      sql`(${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0)`
    ),
    check("ledger_line_currency_inr", sql`${table.currency} = 'INR'`),
    check(
      "ledger_line_memo_length",
      sql`char_length(${table.memo}) BETWEEN 1 AND 200`
    ),
    index("ledger_line_account_id_idx").on(table.accountId),
  ]
);

export type LedgerAccountRow = typeof ledgerAccount.$inferSelect;
export type LedgerPostingRow = typeof ledgerPosting.$inferSelect;
export type LedgerLineRow = typeof ledgerLine.$inferSelect;
