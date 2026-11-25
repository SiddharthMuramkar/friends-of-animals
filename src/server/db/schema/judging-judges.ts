// Invitation secrets are field-encrypted; readiness is derived from the current role and recorded onboarding.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../types/encrypted-text";
import { consentEvent } from "./consent";
import { entry } from "./entries";
import { user } from "./identity";
import { institution } from "./institutions";
import { judgingRound } from "./judging-rounds";
const at = (name: string) => timestamp(name, { withTimezone: true });
const actor = (name: string) =>
  uuid(name).references(() => user.id, { onDelete: "set null" });
export const judgeInvitationStatus = pgEnum("judge_invitation_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
]);
export const judgeConflictSource = pgEnum("judge_conflict_source", [
  "declared",
  "staff",
]);
export const judgeInvitation = pgTable(
  "judge_invitation",
  {
    id: uuid().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => judgingRound.id),
    emailCiphertext: encryptedText("email_ciphertext").notNull(),
    emailHash: text("email_hash").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenCiphertext: encryptedText("token_ciphertext"),
    status: judgeInvitationStatus().notNull().default("pending"),
    invitedByUserId: actor("invited_by_user_id"),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at").notNull(),
    respondedAt: at("responded_at"),
    acceptedUserId: actor("accepted_user_id"),
  },
  (t) => [
    uniqueIndex("judge_invitation_one_pending")
      .on(t.roundId, t.emailHash)
      .where(sql`${t.status} = 'pending'`),
    index("judge_invitation_inviter_idx").on(t.invitedByUserId),
    index("judge_invitation_acceptor_idx").on(t.acceptedUserId),
    check(
      "judge_invitation_token_pending",
      sql`${t.status} = 'pending' OR ${t.tokenCiphertext} IS NULL`
    ),
    check("judge_invitation_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  ]
);
export const judgeOnboarding = pgTable(
  "judge_onboarding",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => judgingRound.id),
    judgeUserId: uuid("judge_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conductConsentEventId: uuid("conduct_consent_event_id").references(
      () => consentEvent.id
    ),
    confidentialityConsentEventId: uuid(
      "confidentiality_consent_event_id"
    ).references(() => consentEvent.id),
    conflictsDeclaredAt: at("conflicts_declared_at"),
    conflictsNone: boolean("conflicts_none"),
    conflictStatement: text("conflict_statement"),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.judgeUserId] }),
    index("judge_onboarding_judge_idx").on(t.judgeUserId),
  ]
);
export const judgeConflict = pgTable(
  "judge_conflict",
  {
    id: uuid().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => judgingRound.id),
    judgeUserId: uuid("judge_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").references(() => institution.id),
    entryId: uuid("entry_id").references(() => entry.id),
    source: judgeConflictSource().notNull(),
    note: text(),
    createdByUserId: actor("created_by_user_id"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    check(
      "judge_conflict_target",
      sql`(${t.source} = 'declared' AND ${t.institutionId} IS NOT NULL AND ${t.entryId} IS NULL) OR (${t.source} = 'staff' AND ${t.institutionId} IS NULL AND ${t.entryId} IS NOT NULL)`
    ),
    uniqueIndex("judge_conflict_institution_unique").on(
      t.roundId,
      t.judgeUserId,
      t.institutionId
    ),
    uniqueIndex("judge_conflict_entry_unique").on(
      t.roundId,
      t.judgeUserId,
      t.entryId
    ),
    index("judge_conflict_judge_idx").on(t.judgeUserId),
    index("judge_conflict_creator_idx").on(t.createdByUserId),
  ]
);
