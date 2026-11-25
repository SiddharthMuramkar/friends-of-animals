// FOA rounds, rubric pins and the pool/assignment relation (#95).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  JUDGING_LEVELS,
  ROUND_ENTRY_SOURCES,
} from "../../modules/judging/domain/round-settings";
import { JUDGING_ROUND_STATUSES } from "../../modules/judging/domain/round-status";
import { awardSchemeEnum } from "./competition-terms";
import { competition, competitionDisciplineEnum } from "./competitions";
import { entry } from "./entries";
import { rubric } from "./judging";
import { user } from "./identity";

const at = (name: string) => timestamp(name, { withTimezone: true });
const actor = (name: string) =>
  uuid(name).references(() => user.id, { onDelete: "set null" });
export const judgingLevel = pgEnum("judging_level", JUDGING_LEVELS);
export const judgingRoundStatus = pgEnum(
  "judging_round_status",
  JUDGING_ROUND_STATUSES
);
export const roundEntrySource = pgEnum(
  "round_entry_source",
  ROUND_ENTRY_SOURCES
);
export const judgingRound = pgTable(
  "judging_round",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    name: text().notNull(),
    nameKey: text("name_key").notNull(),
    level: judgingLevel().notNull().default("national"),
    status: judgingRoundStatus().notNull().default("draft"),
    judgesPhysical: boolean("judges_physical").notNull().default(true),
    awardScheme: awardSchemeEnum("award_scheme")
      .notNull()
      .default("ranked_123"),
    entrySource: roundEntrySource("entry_source")
      .notNull()
      .default("verified_entries"),
    sourceRoundId: uuid("source_round_id"),
    createdByUserId: actor("created_by_user_id"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    openedByUserId: actor("opened_by_user_id"),
    openedAt: at("opened_at"),
    cancelledByUserId: actor("cancelled_by_user_id"),
    cancelledAt: at("cancelled_at"),
    cancelReason: text("cancel_reason"),
    lockedAt: at("locked_at"),
    lockedByUserId: actor("locked_by_user_id"),
    lockOverrideReason: text("lock_override_reason"),
    tieBreakRule: text("tie_break_rule"),
  },
  (t) => [
    unique("judging_round_name_unique").on(t.competitionId, t.nameKey),
    foreignKey({ columns: [t.sourceRoundId], foreignColumns: [t.id] }),
    check(
      "judging_round_source",
      sql`(${t.entrySource} = 'round_finalists') = (${t.sourceRoundId} IS NOT NULL) AND ${t.sourceRoundId} IS DISTINCT FROM ${t.id}`
    ),
    check(
      "judging_round_name_length",
      sql`char_length(${t.name}) BETWEEN 1 AND 120`
    ),
    check(
      "judging_round_cancel_reason",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL AND ${t.cancelReason} IS NOT NULL)`
    ),
    check(
      "judging_round_lock_metadata",
      sql`(${t.status} = 'locked') = (${t.lockedAt} IS NOT NULL AND ${t.tieBreakRule} IS NOT NULL) AND (${t.lockOverrideReason} IS NULL OR ${t.status} = 'locked')`
    ),
    index("judging_round_locked_by_idx").on(t.lockedByUserId),
    index("judging_round_created_by_idx").on(t.createdByUserId),
    index("judging_round_opened_by_idx").on(t.openedByUserId),
    index("judging_round_cancelled_by_idx").on(t.cancelledByUserId),
  ]
);
export type JudgingRound = typeof judgingRound.$inferSelect;
export const judgingRoundRubric = pgTable(
  "judging_round_rubric",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => judgingRound.id),
    discipline: competitionDisciplineEnum().notNull(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.discipline] }),
    index("judging_round_rubric_rubric_idx").on(t.rubricId),
  ]
);
export const roundEntry = pgTable(
  "round_entry",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => judgingRound.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entry.id),
    admittedByUserId: actor("admitted_by_user_id"),
    admittedAt: at("admitted_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.entryId] }),
    index("round_entry_entry_idx").on(t.entryId),
    index("round_entry_admitted_by_idx").on(t.admittedByUserId),
  ]
);
export const roundAssignment = pgTable(
  "round_assignment",
  {
    roundId: uuid("round_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    judgeUserId: uuid("judge_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedByUserId: actor("assigned_by_user_id"),
    assignedAt: at("assigned_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.entryId, t.judgeUserId] }),
    foreignKey({
      columns: [t.roundId, t.entryId],
      foreignColumns: [roundEntry.roundId, roundEntry.entryId],
    }),
    index("round_assignment_judge_idx").on(t.judgeUserId),
    index("round_assignment_assigned_by_idx").on(t.assignedByUserId),
  ]
);
