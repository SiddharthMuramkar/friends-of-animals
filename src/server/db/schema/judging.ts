// FOA judging (#88): each discipline's rubric. A competition manager edits
// a draft; publishing freezes it; publishing a newer version supersedes the
// old one, which stays as it was. A trigger refuses any change to a
// rubric that has left draft, or to its criteria
// (drizzle/*_88_rubric_immutability.sql), so scores given against a
// published rubric always mean what they meant.
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

import { RUBRIC_STATUSES } from "../../modules/judging/domain/rubric-status";
import { competition, competitionDisciplineEnum } from "./competitions";
import { user } from "./identity";

export const rubricStatusEnum = pgEnum("rubric_status", RUBRIC_STATUSES);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const rubric = pgTable(
  "rubric",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    discipline: competitionDisciplineEnum().notNull(),
    /** 1 for a discipline's first rubric, one more for each revision. */
    version: integer().notNull(),
    status: rubricStatusEnum().notNull().default("draft"),
    /** Null for seed data, or once the user's account is gone. */
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    publishedByUserId: uuid("published_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamptz("published_at"),
  },
  (table) => [
    unique("rubric_version_unique").on(
      table.competitionId,
      table.discipline,
      table.version
    ),
    // At most one draft and one published rubric per discipline.
    uniqueIndex("rubric_one_draft_per_discipline")
      .on(table.competitionId, table.discipline)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex("rubric_one_published_per_discipline")
      .on(table.competitionId, table.discipline)
      .where(sql`${table.status} = 'published'`),
    check("rubric_version_positive", sql`${table.version} >= 1`),
    // A rubric has been published exactly when it has left draft.
    check(
      "rubric_published_at_matches_status",
      sql`(${table.status} = 'draft') = (${table.publishedAt} IS NULL)`
    ),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("rubric_created_by_user_id_idx").on(table.createdByUserId),
    index("rubric_published_by_user_id_idx").on(table.publishedByUserId),
  ]
);

export type Rubric = typeof rubric.$inferSelect;

export const rubricCriterion = pgTable(
  "rubric_criterion",
  {
    id: uuid().primaryKey(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id, { onDelete: "cascade" }),
    /** Display order within the rubric, from 0. */
    position: integer().notNull(),
    label: text().notNull(),
    description: text().notNull().default(""),
    /** Share of the score, in percent; a published rubric's total 100. */
    weight: integer().notNull(),
    minScore: integer("min_score").notNull(),
    maxScore: integer("max_score").notNull(),
  },
  (table) => [
    unique("rubric_criterion_position_unique").on(
      table.rubricId,
      table.position
    ),
    // The same bounds as rubricCriteriaSchema (domain/rubric-criteria.ts).
    check("rubric_criterion_position", sql`${table.position} >= 0`),
    check(
      "rubric_criterion_label",
      sql`char_length(${table.label}) BETWEEN 1 AND 120`
    ),
    check(
      "rubric_criterion_description",
      sql`char_length(${table.description}) <= 600`
    ),
    check("rubric_criterion_weight", sql`${table.weight} BETWEEN 1 AND 100`),
    check(
      "rubric_criterion_scores",
      sql`${table.minScore} >= 0 AND ${table.maxScore} <= 100 AND ${table.minScore} < ${table.maxScore}`
    ),
  ]
);

export type RubricCriterionRow = typeof rubricCriterion.$inferSelect;
