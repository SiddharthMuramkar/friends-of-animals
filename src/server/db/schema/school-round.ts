// The school round (#89): one per confirmed institution registration,
// opened when its competition enters school judging. The coordinator
// records the judging panel, picks a shortlist per category (a pick row
// exists exactly when the entry is shortlisted; its school position is an
// optional attribute of the pick), attests the judging and finalises.
// Every status the round will ever need is in the enum from the start
// (ADR 0004, rule F2): overdue and closed-on-behalf come with #90.
//
// Personal data (listed in src/server/modules/privacy/inventory.ts): the
// panel members' names and designations, and the user ids of who picked,
// attested and finalised.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { SCHOOL_ROUND_STATUSES } from "../../modules/school-round/domain/status";
import { competition, competitionCategory } from "./competitions";
import { entry } from "./entries";
import { user } from "./identity";
import { institutionRegistration } from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const schoolRoundStatus = pgEnum(
  "school_round_status",
  SCHOOL_ROUND_STATUSES
);

/** The constraint a second round for one registration runs into. */
export const SCHOOL_ROUND_REGISTRATION_UNIQUE =
  "school_round_institution_registration_unique";

export const schoolRound = pgTable(
  "school_round",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    /** One round per institution registration: opening twice adds nothing. */
    institutionRegistrationId: uuid("institution_registration_id")
      .notNull()
      .unique(SCHOOL_ROUND_REGISTRATION_UNIQUE)
      .references(() => institutionRegistration.id),
    status: schoolRoundStatus().notNull(),
    openedAt: timestamptz("opened_at").notNull(),
    /** Who attested the judging when finalising; null once their account is gone. */
    judgingAttestedByUserId: uuid("judging_attested_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    judgingAttestedAt: timestamptz("judging_attested_at"),
    /** The version of the attestation wording the coordinator confirmed. */
    judgingStatementVersion: text("judging_statement_version"),
    finalisedByUserId: uuid("finalised_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    finalisedAt: timestamptz("finalised_at"),
    /**
     * When the families' outcome messages were queued, once per finalising,
     * so a rerun of that handler queues nothing twice.
     */
    familiesNotifiedAt: timestamptz("families_notified_at"),
    /**
     * A competition manager closed the overdue round on the school's
     * behalf (#90): who, when and why. Cleared when the round is reopened.
     */
    closedByUserId: uuid("closed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    closedAt: timestamptz("closed_at"),
    closeReason: text("close_reason"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("school_round_competition_id_idx").on(table.competitionId),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("school_round_judging_attested_by_user_id_idx").on(
      table.judgingAttestedByUserId
    ),
    index("school_round_finalised_by_user_id_idx").on(table.finalisedByUserId),
    index("school_round_closed_by_user_id_idx").on(table.closedByUserId),
    check(
      "school_round_close_reason_present",
      sql`${table.closeReason} IS NULL OR length(trim(${table.closeReason})) > 0`
    ),
  ]
);

export type SchoolRoundRow = typeof schoolRound.$inferSelect;

/** The judging panel, in the order the coordinator listed it. */
export const schoolRoundPanelMember = pgTable(
  "school_round_panel_member",
  {
    id: uuid().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => schoolRound.id, { onDelete: "cascade" }),
    /** From 0. */
    sortOrder: integer("sort_order").notNull(),
    fullName: text("full_name").notNull(),
    /** Their role, such as "Art teacher". */
    designation: text().notNull(),
  },
  (table) => [
    unique("school_round_panel_member_round_order_unique").on(
      table.roundId,
      table.sortOrder
    ),
    check(
      "school_round_panel_member_order_not_negative",
      sql`${table.sortOrder} >= 0`
    ),
  ]
);

/** A shortlisted entry. Its school position, if any, is on the row. */
export const schoolRoundPick = pgTable(
  "school_round_pick",
  {
    /** An entry is picked at most once. */
    entryId: uuid("entry_id")
      .primaryKey()
      .references(() => entry.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => schoolRound.id, { onDelete: "cascade" }),
    /** The competition category (discipline and age group) it is picked in. */
    categoryId: uuid("category_id")
      .notNull()
      .references(() => competitionCategory.id),
    /** 1 is first place; null is shortlisted without a position. */
    position: integer(),
    pickedByUserId: uuid("picked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    pickedAt: timestamptz("picked_at").notNull(),
  },
  (table) => [
    // One entry per position in a category.
    uniqueIndex("school_round_pick_position_unique")
      .on(table.roundId, table.categoryId, table.position)
      .where(sql`${table.position} IS NOT NULL`),
    check(
      "school_round_pick_position_positive",
      sql`${table.position} IS NULL OR ${table.position} >= 1`
    ),
    index("school_round_pick_round_id_idx").on(table.roundId),
    index("school_round_pick_category_id_idx").on(table.categoryId),
    index("school_round_pick_picked_by_user_id_idx").on(table.pickedByUserId),
  ]
);

/** Every status change of a round, in order. */
export const schoolRoundTransition = pgTable(
  "school_round_transition",
  {
    id: uuid().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => schoolRound.id, { onDelete: "cascade" }),
    /** Null when this change opened the round. */
    fromStatus: schoolRoundStatus("from_status"),
    toStatus: schoolRoundStatus("to_status").notNull(),
    actorKind: text("actor_kind", { enum: ["user", "system"] }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Why, when a person gave a reason (closing on behalf, reopening: #90). */
    reason: text(),
    at: timestamptz("at").notNull(),
  },
  (table) => [
    check(
      "school_round_transition_actor_kind",
      sql`${table.actorKind} IN ('user', 'system')`
    ),
    check(
      "school_round_transition_system_has_no_user",
      sql`${table.actorKind} = 'user' OR ${table.actorUserId} IS NULL`
    ),
    index("school_round_transition_round_id_idx").on(table.roundId),
    index("school_round_transition_actor_user_id_idx").on(table.actorUserId),
  ]
);

export const SCHOOL_ROUND_OUTCOMES = [
  "shortlisted",
  "not_shortlisted",
] as const;

export const schoolRoundOutcome = pgEnum(
  "school_round_outcome",
  SCHOOL_ROUND_OUTCOMES
);

/**
 * What each entry's family was last told about its school round (#90), so
 * that after a reopen and a second decision only the families whose
 * outcome (or school position) changed are told again. No personal data:
 * ids, the outcome and the position.
 */
export const schoolRoundFamilyNotice = pgTable(
  "school_round_family_notice",
  {
    entryId: uuid("entry_id")
      .primaryKey()
      .references(() => entry.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => schoolRound.id, { onDelete: "cascade" }),
    outcome: schoolRoundOutcome().notNull(),
    /** The school position the message named; null if none. */
    position: integer(),
    toldAt: timestamptz("told_at").notNull(),
  },
  (table) => [
    index("school_round_family_notice_round_id_idx").on(table.roundId),
    check(
      "school_round_family_notice_position_shortlisted",
      sql`${table.position} IS NULL OR (${table.outcome} = 'shortlisted' AND ${table.position} >= 1)`
    ),
  ]
);
