// Private engagement history, keyed to the person rather than their guardian.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { COMMUNITY_MEMBER_STATUSES } from "../../modules/community/domain/membership";
import { MILESTONE_KINDS } from "../../modules/community/domain/milestones";
import { user } from "./identity";
import { encryptedText } from "../types/encrypted-text";
import { competition } from "./competitions";
import { participantProfile } from "./registration";

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const subjects = () => ({
  subjectUserId: uuid("subject_user_id").references(() => user.id, {
    onDelete: "cascade",
  }),
  subjectProfileId: uuid("subject_profile_id").references(
    () => participantProfile.id,
    { onDelete: "cascade" }
  ),
});
export const communityMemberStatus = pgEnum(
  "community_member_status",
  COMMUNITY_MEMBER_STATUSES
);
export const engagementMilestoneKind = pgEnum(
  "engagement_milestone_kind",
  MILESTONE_KINDS
);

export const communityMember = pgTable(
  "community_member",
  {
    id: uuid().primaryKey(),
    ...subjects(),
    joinedByUserId: uuid("joined_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Both fields are cleared by retention after departure.
    displayNameCiphertext: encryptedText("display_name_ciphertext"),
    aboutCiphertext: encryptedText("about_ciphertext"),
    status: communityMemberStatus().notNull(),
    joinedAt: instant("joined_at").notNull(),
    leftAt: instant("left_at"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    check(
      "community_member_one_subject",
      sql`num_nonnulls(${t.subjectUserId},${t.subjectProfileId}) = 1`
    ),
    unique("community_member_subject_unique")
      .on(t.subjectUserId, t.subjectProfileId)
      .nullsNotDistinct(),
    check(
      "community_member_status_dates",
      sql`(${t.status} = 'active' AND ${t.leftAt} IS NULL AND ${t.displayNameCiphertext} IS NOT NULL) OR (${t.status} = 'left' AND ${t.leftAt} IS NOT NULL)`
    ),
    index("community_member_profile_idx").on(t.subjectProfileId),
    index("community_member_joined_by_idx").on(t.joinedByUserId),
    index("community_member_status_idx").on(t.status, t.joinedAt, t.id),
  ]
);
export type CommunityMemberRow = typeof communityMember.$inferSelect;

export const engagementMilestone = pgTable(
  "engagement_milestone",
  {
    id: uuid().primaryKey(),
    ...subjects(),
    kind: engagementMilestoneKind().notNull(),
    competitionId: uuid("competition_id").references(() => competition.id, {
      onDelete: "cascade",
    }),
    achievedAt: instant("achieved_at").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
  },
  (t) => [
    check(
      "engagement_milestone_one_subject",
      sql`num_nonnulls(${t.subjectUserId},${t.subjectProfileId}) = 1`
    ),
    unique("engagement_milestone_logical_unique")
      .on(t.subjectUserId, t.subjectProfileId, t.kind, t.competitionId)
      .nullsNotDistinct(),
    check(
      "engagement_milestone_competition_scope",
      sql`(${t.kind} IN ('participant','school_winner','foa_finalist')) = (${t.competitionId} IS NOT NULL)`
    ),
    index("engagement_milestone_profile_idx").on(t.subjectProfileId),
    index("engagement_milestone_competition_idx").on(t.competitionId),
  ]
);
export type EngagementMilestoneRow = typeof engagementMilestone.$inferSelect;

export const timelineEntry = pgTable(
  "timeline_entry",
  {
    id: uuid().primaryKey(),
    ...subjects(),
    kind: text().notNull(),
    occurredAt: instant("occurred_at").notNull(),
    // Milestone entries follow the milestone through erasure; ordinary entries
    // carry an immutable reference to the event/task/club that produced them.
    milestoneId: uuid("milestone_id").references(() => engagementMilestone.id, {
      onDelete: "cascade",
    }),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    sourceKey: text("source_key").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    check(
      "timeline_entry_one_subject",
      sql`num_nonnulls(${t.subjectUserId},${t.subjectProfileId}) = 1`
    ),
    unique("timeline_entry_source_unique")
      .on(t.subjectUserId, t.subjectProfileId, t.sourceKey)
      .nullsNotDistinct(),
    index("timeline_entry_user_date_idx").on(
      t.subjectUserId,
      t.occurredAt,
      t.id
    ),
    index("timeline_entry_profile_date_idx").on(
      t.subjectProfileId,
      t.occurredAt,
      t.id
    ),
    index("timeline_entry_milestone_idx").on(t.milestoneId),
  ]
);
