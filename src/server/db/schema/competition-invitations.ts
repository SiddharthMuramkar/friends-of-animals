import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { competition } from "./competitions";
import { user } from "./identity";
import { participantProfile } from "./registration";
import { resultRelease } from "./results";
import type { InvitationAction } from "../../modules/invitations/actions";

const at = (name: string) => timestamp(name, { withTimezone: true });
export const competitionInvitationStatus = pgEnum(
  "competition_invitation_status",
  ["queued", "sent", "skipped"]
);
export const competitionInvitationTrigger = pgEnum(
  "competition_invitation_trigger",
  ["results_published", "pilot_backfill"]
);
export const competitionInvitation = pgTable(
  "competition_invitation",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => resultRelease.id),
    participantProfileId: uuid("participant_profile_id")
      .notNull()
      .references(() => participantProfile.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    trigger: competitionInvitationTrigger().notNull(),
    status: competitionInvitationStatus().notNull().default("queued"),
    createdAt: at("created_at").notNull(),
    acceptedActions: jsonb("accepted_actions")
      .$type<InvitationAction[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    unique("competition_invitation_once").on(
      t.competitionId,
      t.participantProfileId
    ),
    index("competition_invitation_profile_idx").on(t.participantProfileId),
    index("competition_invitation_recipient_idx").on(t.recipientUserId),
  ]
);
