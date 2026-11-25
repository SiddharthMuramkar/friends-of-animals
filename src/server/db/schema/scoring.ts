// One sheet per live round assignment. Removing an assignment (including
// a newly declared conflict) also removes its scores; the completion/change
// audit remains. A scored entry never outlives its assignment in rankings.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { rubricCriterion } from "./judging";
import { roundAssignment } from "./judging-rounds";
const at = (name: string) => timestamp(name, { withTimezone: true });
export const scoreSheet = pgTable(
  "score_sheet",
  {
    id: uuid().primaryKey(),
    roundId: uuid("round_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    judgeUserId: uuid("judge_user_id").notNull(),
    comment: text().notNull().default(""),
    commentVersion: integer("comment_version").notNull().default(0),
    complete: boolean().notNull().default(false),
    version: integer().notNull().default(0),
    /** The first completion, retained if a subsequent save clears a score. */
    completedAt: at("completed_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    unique("score_sheet_assignment_unique").on(
      t.roundId,
      t.entryId,
      t.judgeUserId
    ),
    foreignKey({
      columns: [t.roundId, t.entryId, t.judgeUserId],
      foreignColumns: [
        roundAssignment.roundId,
        roundAssignment.entryId,
        roundAssignment.judgeUserId,
      ],
    }).onDelete("cascade"),
    check(
      "score_sheet_version",
      sql`${t.version} >= 0 AND ${t.commentVersion} BETWEEN 0 AND ${t.version}`
    ),
    check("score_sheet_comment_length", sql`char_length(${t.comment}) <= 2000`),
    check(
      "score_sheet_completed",
      sql`NOT ${t.complete} OR ${t.completedAt} IS NOT NULL`
    ),
  ]
);
export const criterionScore = pgTable(
  "criterion_score",
  {
    scoreSheetId: uuid("score_sheet_id")
      .notNull()
      .references(() => scoreSheet.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => rubricCriterion.id),
    value: smallint(),
    changedAtVersion: integer("changed_at_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scoreSheetId, t.criterionId] }),
    index("criterion_score_criterion_idx").on(t.criterionId),
    check("criterion_score_range", sql`${t.value} BETWEEN 0 AND 100`),
    check("criterion_score_version", sql`${t.changedAtVersion} > 0`),
  ]
);
