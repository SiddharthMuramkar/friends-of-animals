import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CLUB_STATUSES } from "../../modules/clubs/domain/status";
import { encryptedText } from "../types/encrypted-text";
import { user } from "./identity";
import { institution } from "./institutions";

const date = (name: string) => timestamp(name, { withTimezone: true });
export const clubStatusEnum = pgEnum("club_status", CLUB_STATUSES);
export const clubRoleEnum = pgEnum("club_member_role", ["student", "teacher"]);

export const club = pgTable(
  "club",
  {
    id: uuid().primaryKey(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institution.id),
    name: text().notNull(),
    applicantUserId: uuid("applicant_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    applicantKind: clubRoleEnum("applicant_kind").notNull(),
    applicantVerified: boolean("applicant_verified").notNull(),
    status: clubStatusEnum().notNull(),
    appliedAt: date("applied_at").notNull(),
    updatedAt: date("updated_at").notNull(),
  },
  (t) => [
    index("club_institution_status_idx").on(t.institutionId, t.status),
    index("club_applicant_idx").on(t.applicantUserId),
    uniqueIndex("club_pending_application_unique")
      .on(t.applicantUserId, t.institutionId)
      .where(sql`${t.status} = 'applied'`),
  ]
);

// One record per stint, not a mutable joined date. The row id is the
// timeline's stable source identity for both joining and leaving.
export const clubMembership = pgTable(
  "club_membership",
  {
    id: uuid().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: clubRoleEnum().notNull(),
    affiliationVerified: boolean("affiliation_verified").notNull(),
    joinedAt: date("joined_at").notNull(),
    leftAt: date("left_at"),
  },
  (t) => [
    uniqueIndex("club_membership_active_unique")
      .on(t.clubId, t.userId)
      .where(sql`${t.leftAt} IS NULL`),
    index("club_membership_user_idx").on(t.userId),
    check(
      "club_membership_time_order",
      sql`${t.leftAt} IS NULL OR ${t.leftAt} >= ${t.joinedAt}`
    ),
  ]
);

// Preserve the particular decision for delayed notification delivery. A
// later decision cannot change what an earlier notice says.
export const clubDecision = pgTable(
  "club_decision",
  {
    id: uuid().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => club.id, { onDelete: "cascade" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    fromStatus: clubStatusEnum("from_status").notNull(),
    toStatus: clubStatusEnum("to_status").notNull(),
    reasonCiphertext: encryptedText("reason_ciphertext"),
    decidedAt: date("decided_at").notNull(),
  },
  (t) => [
    index("club_decision_club_idx").on(t.clubId, t.decidedAt),
    index("club_decision_actor_idx").on(t.decidedByUserId),
  ]
);
export type Club = typeof club.$inferSelect;
export type ClubMembership = typeof clubMembership.$inferSelect;
