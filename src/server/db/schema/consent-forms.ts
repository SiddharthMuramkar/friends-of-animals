// Signed consent forms (#83). A coordinator uploads a scan of the paper form
// a guardian signed (a private file, purpose consent_form) and records which
// public uses the guardian ticked; an FOA admin then accepts or rejects it.
// Consent events are written only when a form is accepted
// (src/server/modules/consent-forms/review.ts), so a pending, rejected or
// withdrawn form counts for nothing.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  PUBLIC_PURPOSES,
  type PublicPurpose,
} from "../../modules/consent/domain/public-use";
import {
  FORM_STATUSES,
  REJECTION_NOTE_MAX,
  REJECTION_REASONS,
} from "../../modules/consent-forms/domain/review";
import { fileAsset } from "./files";
import { competition } from "./competitions";
import { user } from "./identity";
import {
  institutionRegistration,
  participantProfile,
  registration,
} from "./registration";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const consentFormStatus = pgEnum("consent_form_status", FORM_STATUSES);

export const consentFormRejectionReason = pgEnum(
  "consent_form_rejection_reason",
  REJECTION_REASONS
);

/**
 * For each ticked use, the consent document version the competition
 * offered when the form was submitted: what an accepted form's consent
 * points at. Document versions never change once published (#64).
 */
export type PinnedDocuments = Partial<
  Record<PublicPurpose, { documentId: string; version: number }>
>;

const KNOWN_USES = sql.raw(
  `ARRAY[${PUBLIC_PURPOSES.map((purpose) => `'${purpose}'`).join(", ")}]::text[]`
);

/** Binds a Files upload to the exact school enrolment it was requested for. */
export const consentFormUpload = pgTable(
  "consent_form_upload",
  {
    fileAssetId: uuid("file_asset_id")
      .primaryKey()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registration.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("consent_form_upload_registration_id_idx").on(table.registrationId),
  ]
);

export const consentForm = pgTable(
  "consent_form",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    /** The institution's registration the student is enrolled through. */
    institutionRegistrationId: uuid("institution_registration_id")
      .notNull()
      .references(() => institutionRegistration.id),
    /**
     * The scan. One form per file, so a rejected form's scan can't be
     * submitted again; restricted, like the file's owner, so the scan
     * outlives neither the form nor its record.
     */
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .unique()
      .references(() => fileAsset.id, { onDelete: "restrict" }),
    /** The public uses the guardian ticked, as the coordinator recorded them. */
    uses: text().array().$type<PublicPurpose[]>().notNull(),
    documents: jsonb().$type<PinnedDocuments>().notNull(),
    status: consentFormStatus().notNull().default("pending_review"),
    /** The coordinator who uploaded and submitted it (the file's owner). */
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    submittedAt: timestamptz("submitted_at").notNull(),
    /** The FOA admin who accepted or rejected it: on the record for good. */
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamptz("reviewed_at"),
    rejectionReason: consentFormRejectionReason("rejection_reason"),
    /** The reviewer's note to the coordinator. Never personal data. */
    rejectionNote: text("rejection_note"),
    withdrawnAt: timestamptz("withdrawn_at"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One form waits for review at a time per student and competition.
    uniqueIndex("consent_form_one_pending_idx")
      .on(table.participantProfileId, table.competitionId)
      .where(sql`${table.status} = 'pending_review'`),
    // The review queue, oldest first.
    index("consent_form_status_submitted_idx").on(
      table.status,
      table.submittedAt
    ),
    // The coordinator dashboard's column, per registration and student.
    index("consent_form_registration_idx").on(
      table.institutionRegistrationId,
      table.participantProfileId
    ),
    index("consent_form_uploaded_by_user_id_idx").on(table.uploadedByUserId),
    index("consent_form_reviewed_by_user_id_idx").on(table.reviewedByUserId),
    check(
      "consent_form_uses_known",
      sql`cardinality(${table.uses}) > 0 AND ${table.uses} <@ ${KNOWN_USES}`
    ),
    check(
      "consent_form_reviewed_iff_decided",
      sql`(${table.status} IN ('accepted', 'rejected')) = (${table.reviewedByUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`
    ),
    check(
      "consent_form_reason_iff_rejected",
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} IS NOT NULL)`
    ),
    check(
      "consent_form_note_only_on_rejection",
      sql`${table.rejectionNote} IS NULL OR (${table.status} = 'rejected' AND char_length(${table.rejectionNote}) <= ${sql.raw(String(REJECTION_NOTE_MAX))})`
    ),
    check(
      "consent_form_withdrawn_iff_withdrawn",
      sql`(${table.status} = 'withdrawn') = (${table.withdrawnAt} IS NOT NULL)`
    ),
  ]
);

export type ConsentFormRow = typeof consentForm.$inferSelect;
