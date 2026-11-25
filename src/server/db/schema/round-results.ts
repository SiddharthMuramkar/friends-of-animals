// A locked ranking is a snapshot, not a query over mutable assignments.
// Only the manager's recognition tags can subsequently change.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { ROUND_OUTCOMES } from "../../modules/judging/domain/outcomes";
import type { DecidedBy } from "../../modules/judging/domain/ranking";
import { competitionDisciplineEnum } from "./competitions";
import { roundEntry } from "./judging-rounds";

export const roundOutcome = pgEnum("round_outcome", ROUND_OUTCOMES);
export const roundResult = pgTable(
  "round_result",
  {
    roundId: uuid("round_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    code: text().notNull(),
    discipline: competitionDisciplineEnum().notNull(),
    categoryId: uuid("category_id").notNull(),
    rank: integer().notNull(),
    // Reduced exact rational numbers, stored as decimal strings (not floats).
    scoreNumerator: text("score_numerator").notNull(),
    scoreDenominator: text("score_denominator").notNull(),
    sheetsCounted: integer("sheets_counted").notNull(),
    decidedBy: jsonb("decided_by").$type<DecidedBy>(),
    outcome: roundOutcome().notNull().default("none"),
    awardPosition: integer("award_position"),
    suitableForAuction: boolean("suitable_for_auction")
      .notNull()
      .default(false),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.entryId] }),
    foreignKey({
      columns: [t.roundId, t.entryId],
      foreignColumns: [roundEntry.roundId, roundEntry.entryId],
    }).onDelete("cascade"),
    check("round_result_rank", sql`${t.rank} > 0 AND ${t.sheetsCounted} > 0`),
    check(
      "round_result_fraction",
      sql`${t.scoreNumerator} ~ '^[0-9]+$' AND ${t.scoreDenominator} ~ '^[1-9][0-9]*$'`
    ),
    check(
      "round_result_award_position",
      sql`CASE ${t.outcome} WHEN 'winner' THEN ${t.awardPosition} IS NOT DISTINCT FROM 1 WHEN 'runner_up' THEN ${t.awardPosition} IS NOT NULL AND ${t.awardPosition} BETWEEN 2 AND 3 ELSE ${t.awardPosition} IS NULL END`
    ),
  ]
);
export type RoundResult = typeof roundResult.$inferSelect;
