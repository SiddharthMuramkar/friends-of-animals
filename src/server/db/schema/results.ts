// Recognition approved by two different staff. No names, credit or scores
// are copied: the award rows refer to the entries and frozen categories.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { RESULTS_RELEASE_STATUSES } from "../../modules/results/domain/release-status";
import type { AwardBand } from "../../modules/competitions/domain/award-schemes";
import { competition, competitionDisciplineEnum } from "./competitions";
import { entry } from "./entries";
import { judgingRound } from "./judging-rounds";
import { roundOutcome } from "./round-results";
import { user } from "./identity";
const at = (name: string) => timestamp(name, { withTimezone: true });
const actor = (name: string) =>
  uuid(name).references(() => user.id, { onDelete: "set null" });
export const resultReleaseStatus = pgEnum(
  "result_release_status",
  RESULTS_RELEASE_STATUSES
);
export const resultRelease = pgTable(
  "result_release",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    sourceRoundId: uuid("source_round_id")
      .notNull()
      .references(() => judgingRound.id),
    status: resultReleaseStatus().notNull().default("pending_approval"),
    preparedByUserId: actor("prepared_by_user_id"),
    preparedAt: at("prepared_at").notNull(),
    approvedByUserId: actor("approved_by_user_id"),
    approvedAt: at("approved_at"),
    publishAt: at("publish_at").notNull(),
    publishedAt: at("published_at"),
    rejectedAt: at("rejected_at"),
    contentHash: text("content_hash").notNull(),
    deliveryNote: text("delivery_note").notNull(),
  },
  (t) => [
    // At most one non-rejected release, including a published one.
    uniqueIndex("result_release_active")
      .on(t.competitionId)
      .where(sql`${t.status} <> 'rejected'`),
    index("result_release_source_idx").on(t.sourceRoundId),
    index("result_release_competition_idx").on(t.competitionId),
    index("result_release_preparer_idx").on(t.preparedByUserId),
    index("result_release_approver_idx").on(t.approvedByUserId),
    check(
      "release_distinct_staff",
      sql`${t.preparedByUserId} IS NULL OR ${t.approvedByUserId} IS NULL OR ${t.preparedByUserId} <> ${t.approvedByUserId}`
    ),
    check(
      "release_times",
      sql`${t.publishAt} > ${t.preparedAt} AND (${t.publishedAt} IS NULL OR ${t.publishedAt} >= ${t.publishAt}) AND (${t.status} = 'published') = (${t.publishedAt} IS NOT NULL) AND (${t.status} = 'rejected') = (${t.rejectedAt} IS NOT NULL) AND (${t.status} NOT IN ('approved', 'published') OR ${t.approvedAt} IS NOT NULL)`
    ),
  ]
);
export type ResultRelease = typeof resultRelease.$inferSelect;
export const resultAward = pgTable(
  "result_award",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => resultRelease.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entry.id, { onDelete: "cascade" }),
    discipline: competitionDisciplineEnum().notNull(),
    categoryId: uuid("category_id").notNull(),
    categoryLabel: text("category_label").notNull(),
    outcome: roundOutcome().notNull(),
    awardPosition: integer("award_position"),
    awardBand: text("award_band").$type<AwardBand>(),
    prize: text(),
    suitableForAuction: boolean("suitable_for_auction").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.entryId] }),
    index("result_award_entry_idx").on(t.entryId),
    check(
      "result_award_recognition",
      sql`(${t.outcome} <> 'none' OR ${t.suitableForAuction}) AND (${t.outcome} IN ('winner','runner_up')) = (${t.awardPosition} IS NOT NULL AND ${t.awardBand} IS NOT NULL)`
    ),
  ]
);
export type ResultAward = typeof resultAward.$inferSelect;
