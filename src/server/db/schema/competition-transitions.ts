// Moves the schedule refused (#88). A guard on the competition status
// machine (src/server/modules/competitions/transition-guards.ts) can hold
// a scheduled move back: the competition stays where it is, and one open
// row here records why, until a later attempt makes the move and
// resolves it. At most one open row per competition and target status,
// so a refusal is recorded, and its managers told, once.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { competition, competitionStatusEnum } from "./competitions";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const competitionTransitionBlock = pgTable(
  "competition_transition_block",
  {
    id: uuid().primaryKey(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competition.id),
    fromStatus: competitionStatusEnum("from_status").notNull(),
    toStatus: competitionStatusEnum("to_status").notNull(),
    /** A TRANSITION_BLOCK reason (modules/competitions/domain/transition-block.ts). */
    reason: text().notNull(),
    /** The rest of the TRANSITION_BLOCK, as of the latest refused attempt. */
    details: jsonb().$type<Record<string, unknown>>().notNull(),
    blockedAt: timestamptz("blocked_at").notNull(),
    /** When a later attempt made the move; null while it is refused. */
    resolvedAt: timestamptz("resolved_at"),
  },
  (table) => [
    uniqueIndex("competition_transition_block_open")
      .on(table.competitionId, table.toStatus)
      .where(sql`${table.resolvedAt} IS NULL`),
    index("competition_transition_block_competition_idx").on(
      table.competitionId
    ),
  ]
);

export type CompetitionTransitionBlock =
  typeof competitionTransitionBlock.$inferSelect;
