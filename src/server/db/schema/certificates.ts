// A certificate's validity is independent of its private PDF's readiness.
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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  CERTIFICATE_TYPES,
  CERTIFICATE_STATUSES,
  CERTIFICATE_RENDER_STATUSES,
} from "../../modules/certificates/domain/status";
import { competition } from "./competitions";
import { registration, participantProfile } from "./registration";
import { entry } from "./entries";
import { schoolRound } from "./school-round";
import { judgingRound } from "./judging-rounds";
import { resultRelease } from "./results";
import { fileAsset } from "./files";
import { user } from "./identity";
const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const certificateType = pgEnum("certificate_type", CERTIFICATE_TYPES);
export const certificateStatus = pgEnum(
  "certificate_status",
  CERTIFICATE_STATUSES
);
export const certificateRenderStatus = pgEnum(
  "certificate_render_status",
  CERTIFICATE_RENDER_STATUSES
);
export const CERTIFICATE_NUMBER_UNIQUE = "certificate_number_unique";
export const certificate = pgTable(
  "certificate",
  {
    id: uuid().primaryKey(),
    number: text().notNull(),
    type: certificateType().notNull(),
    status: certificateStatus().notNull().default("issued"),
    competitionId: uuid("competition_id").references(() => competition.id),
    registrationId: uuid("registration_id").references(() => registration.id),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id),
    entryId: uuid("entry_id").references(() => entry.id, {
      onDelete: "set null",
    }),
    schoolRoundId: uuid("school_round_id").references(() => schoolRound.id),
    roundId: uuid("round_id").references(() => judgingRound.id),
    awardPosition: integer("award_position"),
    awardLabel: text("award_label"),
    nameSnapshot: text("name_snapshot").notNull(),
    templateVersion: integer("template_version").notNull().default(1),
    renderStatus: certificateRenderStatus("render_status")
      .notNull()
      .default("pending"),
    renderAttempts: integer("render_attempts").notNull().default(0),
    pdfFileId: uuid("pdf_file_id").references(() => fileAsset.id, {
      onDelete: "set null",
    }),
    issuedAt: at("issued_at").notNull(),
    sourceReleaseId: uuid("source_release_id").references(
      () => resultRelease.id
    ),
    revokedAt: at("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedReason: text("revoked_reason"),
    supersededById: uuid("superseded_by_id").references(
      (): AnyPgColumn => certificate.id,
      { onDelete: "set null" }
    ),
  },
  (t) => [
    unique(CERTIFICATE_NUMBER_UNIQUE).on(t.number),
    unique("certificate_pdf_unique").on(t.pdfFileId),
    uniqueIndex("certificate_earned_unique")
      .on(t.registrationId, t.type, t.schoolRoundId, t.roundId)
      .where(
        sql`${t.status} <> 'superseded' AND ${t.registrationId} IS NOT NULL`
      ),
    // Indexes with NULLS NOT DISTINCT cannot be declared on uniqueIndex in Drizzle;
    // the separate partial indexes below ensure each award identity is unique.
    uniqueIndex("certificate_participation_identity")
      .on(t.registrationId, t.type)
      .where(
        sql`${t.registrationId} IS NOT NULL AND ${t.schoolRoundId} IS NULL AND ${t.roundId} IS NULL AND ${t.status} <> 'superseded'`
      ),
    uniqueIndex("certificate_school_identity")
      .on(t.registrationId, t.type, t.schoolRoundId)
      .where(
        sql`${t.schoolRoundId} IS NOT NULL AND ${t.status} <> 'superseded'`
      ),
    uniqueIndex("certificate_foa_identity")
      .on(t.registrationId, t.type, t.roundId)
      .where(sql`${t.roundId} IS NOT NULL AND ${t.status} <> 'superseded'`),
    check(
      "certificate_number_format",
      sql`${t.number} ~ '^FOA-C-[0-9]{2}-[0-9A-HJKMNP-TV-Z]{10}$'`
    ),
    check(
      "certificate_competition_pair",
      sql`(${t.competitionId} IS NULL) = (${t.registrationId} IS NULL)`
    ),
    check(
      "certificate_round_kind",
      sql`${t.schoolRoundId} IS NULL OR ${t.roundId} IS NULL`
    ),
    check("certificate_attempts_nonnegative", sql`${t.renderAttempts} >= 0`),
    index("certificate_profile_idx").on(t.participantProfileId),
    index("certificate_competition_idx").on(t.competitionId),
    index("certificate_release_idx").on(t.sourceReleaseId),
  ]
);
export type CertificateRow = typeof certificate.$inferSelect;
// One notification for each recipient and each release, even under concurrent renders.
export const certificateReadyNotice = pgTable(
  "certificate_ready_notice",
  {
    releaseId: uuid("release_id")
      .notNull()
      .references(() => resultRelease.id),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    unique("certificate_ready_notice_identity").on(
      t.releaseId,
      t.recipientUserId
    ),
  ]
);
