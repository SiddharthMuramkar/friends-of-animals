// Campaigns (#126): a message a community manager writes once and sends to
// a segment, in plain text (never HTML). Sending stamps who sent it, when,
// and the counts the plan had; it then holds one `campaign_recipient` row
// per person a message goes to, with the consents it rests on and the hash
// of its withdrawal link. The in-app and email copies themselves go through
// the notifications module (`message_delivery`, `inbox_item`).
//
// The data inventory covers the staff accounts and each recipient row.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  AudienceCounts,
  ConsentBasis,
} from "../../modules/campaigns/domain/audience";
import {
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_STATUSES,
} from "../../modules/campaigns/domain/campaign";
import type { SegmentDefinition } from "../../modules/campaigns/domain/segment";
import { user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const campaignStatusEnum = pgEnum("campaign_status", CAMPAIGN_STATUSES);

export const campaignRecipientStatusEnum = pgEnum(
  "campaign_recipient_status",
  CAMPAIGN_RECIPIENT_STATUSES
);

export const campaign = pgTable(
  "campaign",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    status: campaignStatusEnum().notNull().default("draft"),
    revision: integer().notNull().default(1),
    subject: text().notNull(),
    body: text().notNull(),
    /** The canonical definition (src/server/modules/campaigns/domain/segment.ts). */
    segment: jsonb().$type<SegmentDefinition>().notNull(),
    /** Null for seed data, or once the account is gone. */
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    sentBy: uuid("sent_by").references(() => user.id, {
      onDelete: "set null",
    }),
    sentAt: timestamptz("sent_at"),
    /** What the plan held when it was sent: numbers only, never who. */
    plannedCounts: jsonb("planned_counts").$type<AudienceCounts>(),
    /** When the worker settled the last recipient. */
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    // A draft has no send stamps; a sent or sending campaign has them all.
    check(
      "campaign_sent_stamped",
      sql`(${table.status} = 'draft') = (${table.sentAt} IS NULL) AND (${table.sentAt} IS NULL) = (${table.plannedCounts} IS NULL)`
    ),
    check(
      "campaign_completed_when_sent",
      sql`(${table.status} = 'sent') = (${table.completedAt} IS NOT NULL)`
    ),
    check("campaign_revision_positive", sql`${table.revision} > 0`),
    index("campaign_newest_idx").on(table.createdAt.desc(), table.id.desc()),
    // Deleting a user sets these to null; the indexes keep that from scanning.
    index("campaign_created_by_idx").on(table.createdBy),
    index("campaign_sent_by_idx").on(table.sentBy),
  ]
);

export type CampaignRow = typeof campaign.$inferSelect;

/** One person a sent campaign's message goes to. */
export const campaignRecipient = pgTable(
  "campaign_recipient",
  {
    /** UUIDv7 from the clock. */
    id: uuid().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaign.id),
    /** Who the message goes to: an adult, or a child's guardian. */
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The consents the message rests on: whose, and for what purpose. */
    bases: jsonb().$type<ConsentBasis[]>().notNull(),
    /** SHA-256 of the withdrawal link's token, lower-case hex. */
    tokenHash: text("token_hash").notNull().unique(),
    status: campaignRecipientStatusEnum().notNull().default("queued"),
    createdAt: timestamptz("created_at").notNull(),
    /** When the worker sent or skipped it. */
    settledAt: timestamptz("settled_at"),
    /** When its withdrawal link was used. */
    withdrawnAt: timestamptz("withdrawn_at"),
  },
  (table) => [
    unique("campaign_recipient_once").on(table.campaignId, table.userId),
    check(
      "campaign_recipient_settled_stamped",
      sql`(${table.status} = 'queued') = (${table.settledAt} IS NULL)`
    ),
    check(
      "campaign_recipient_has_bases",
      sql`jsonb_array_length(${table.bases}) > 0`
    ),
    // The worker counts a campaign's waiting messages.
    index("campaign_recipient_campaign_status_idx").on(
      table.campaignId,
      table.status
    ),
    // Deleting a user deletes their rows; the index keeps that from scanning.
    index("campaign_recipient_user_id_idx").on(table.userId),
  ]
);

export type CampaignRecipientRow = typeof campaignRecipient.$inferSelect;
