// Physical artwork custody records (#94). Current physicalArtwork.status is
// authoritative; the append-only trail records receipt and each custody move.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { physicalArtwork } from "./physical-artwork";
import { fileAsset } from "./files";
import { user } from "./identity";
import { competition } from "./competitions";
import {
  ARTWORK_CONDITIONS,
  CONDITION_PHOTO_KINDS,
  type ReturnVia,
} from "../../modules/physical-artwork/domain/custody";

const stamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const artworkFk = () =>
  uuid("artwork_id")
    .notNull()
    .references(() => physicalArtwork.id, { onDelete: "cascade" });
const actorFk = (name: string) =>
  uuid(name).references(() => user.id, { onDelete: "set null" });

export const artworkCondition = pgEnum("artwork_condition", ARTWORK_CONDITIONS);
export const artworkPhotoKind = pgEnum(
  "artwork_photo_kind",
  CONDITION_PHOTO_KINDS
);
export const artworkCustodyKind = pgEnum("artwork_custody_kind", [
  "received",
  "stored",
  "exhibited",
  "moved",
  "retained",
  "returned",
]);

export const artworkVerification = pgTable(
  "artwork_verification",
  {
    artworkId: artworkFk().primaryKey(),
    verifiedBy: actorFk("verified_by"),
    verifiedAt: stamp("verified_at").notNull(),
    codeMatchesLabel: boolean("code_matches_label").notNull(),
    creatorConfirmed: boolean("creator_confirmed").notNull(),
    matchesDigital: boolean("matches_digital").notNull(),
    consentDocumentsOk: boolean("consent_documents_ok").notNull(),
    condition: artworkCondition().notNull(),
    conditionNotes: text("condition_notes"),
    widthMm: integer("width_mm").notNull(),
    heightMm: integer("height_mm").notNull(),
    depthMm: integer("depth_mm"),
    material: text().notNull(),
  },
  (t) => [
    check(
      "artwork_verification_dimensions",
      sql`${t.widthMm} BETWEEN 1 AND 10000 AND ${t.heightMm} BETWEEN 1 AND 10000 AND (${t.depthMm} IS NULL OR ${t.depthMm} BETWEEN 1 AND 10000)`
    ),
    check(
      "artwork_verification_passed",
      sql`${t.codeMatchesLabel} AND ${t.creatorConfirmed} AND ${t.matchesDigital} AND ${t.consentDocumentsOk}`
    ),
  ]
);

// A photo belongs to one artwork from presign onwards; it becomes evidence
// on verification, and no other artwork can claim it.
export const artworkPhoto = pgTable(
  "artwork_photo",
  {
    id: uuid().primaryKey(),
    artworkId: artworkFk(),
    fileAssetId: uuid("file_asset_id")
      .notNull()
      .unique()
      .references(() => fileAsset.id, { onDelete: "cascade" }),
    kind: artworkPhotoKind().notNull(),
    createdBy: actorFk("created_by"),
    createdAt: stamp("created_at").notNull(),
    selectedAt: stamp("selected_at"),
  },
  (t) => [index("artwork_photo_artwork_idx").on(t.artworkId)]
);

export const artworkDiscrepancy = pgTable(
  "artwork_discrepancy",
  {
    id: uuid().primaryKey(),
    artworkId: artworkFk(),
    reason: text().notNull(),
    notes: text().notNull(),
    raisedBy: actorFk("raised_by"),
    raisedAt: stamp("raised_at").notNull(),
    resolvedBy: actorFk("resolved_by"),
    resolvedAt: stamp("resolved_at"),
    resolution: text(),
  },
  (t) => [
    uniqueIndex("artwork_discrepancy_one_open")
      .on(t.artworkId)
      .where(sql`${t.resolvedAt} IS NULL`),
    check(
      "artwork_discrepancy_resolution",
      sql`(${t.resolvedAt} IS NULL) = (${t.resolution} IS NULL)`
    ),
  ]
);

export const artworkCustodyEvent = pgTable(
  "artwork_custody_event",
  {
    id: uuid().primaryKey(),
    artworkId: artworkFk(),
    kind: artworkCustodyKind().notNull(),
    location: text(),
    // As with audit_log, no user FK because the event cannot be edited.
    actorUserId: uuid("actor_user_id"),
    at: stamp("at").notNull(),
    returnVia: jsonb("return_via").$type<ReturnVia>(),
  },
  (t) => [
    index("artwork_custody_event_artwork_idx").on(t.artworkId, t.at, t.id),
  ]
);

export const artworkReturnRequest = pgTable(
  "artwork_return_request",
  {
    artworkId: artworkFk().primaryKey(),
    requestedBy: actorFk("requested_by"),
    requestedAt: stamp("requested_at").notNull(),
    fulfilledAt: stamp("fulfilled_at"),
    via: jsonb().$type<ReturnVia>(),
  },
  (t) => [
    check(
      "artwork_return_request_fulfilment",
      sql`(${t.fulfilledAt} IS NULL) = (${t.via} IS NULL)`
    ),
  ]
);

// The first actual published release opens the window; later releases do
// not reset it. No caller-facing input can create this record.
export const artworkResultsWindow = pgTable(
  "artwork_results_window",
  {
    competitionId: uuid("competition_id")
      .primaryKey()
      .references(() => competition.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").notNull(),
    resultsPublishedAt: stamp("results_published_at").notNull(),
    closesAt: stamp("closes_at").notNull(),
  },
  (t) => [
    check(
      "artwork_results_window_order",
      sql`${t.closesAt} > ${t.resultsPublishedAt}`
    ),
  ]
);
