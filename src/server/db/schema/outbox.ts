// The outbox (#61). A use case saves a change and its domain event in one
// transaction (src/server/outbox/emit.ts): one row per handler that listens
// to the event, so each handler's delivery is claimed, retried and settled
// on its own. The relay (src/server/outbox/relay.ts) runs in the VPS worker,
// in the preview drain route and in the Seam 1 harness. Payloads hold ids
// only, never personal data: rows stay here, and staff read failed ones.
//
// Retention (#114) purges eligible dispatched rows. Failed rows stay
// until staff resolve them.
//
// Loads under plain Node (drizzle-kit, the worker): relative imports only,
// no "server-only".

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

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** Only a pending delivery is ever claimed; the other two are final. */
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "dispatched",
  "failed",
]);

/** One delivery: an event, for one handler. */
export const outbox = pgTable(
  "outbox",
  {
    /** UUIDv7; also the delivery's idempotency key. */
    id: uuid().primaryKey(),
    /** Shared by every delivery of one event. */
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    /** Which handler runs it (src/server/outbox/handlers.ts). */
    handler: text().notNull(),
    /** Ids only (each event's zod schema in src/server/outbox/events.ts). */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    /** Not claimed before this instant: a retry's backoff, or a later action. */
    availableAt: timestamptz("available_at").notNull(),
    /** Set while claimed. Once past, a claim that never settled is due again. */
    lockedUntil: timestamptz("locked_until"),
    /** Claims so far, the running one included. */
    attempts: integer().notNull().default(0),
    /** Why the last attempt failed, with no personal data in it. */
    lastError: text("last_error"),
    status: outboxStatus().notNull().default("pending"),
    dispatchedAt: timestamptz("dispatched_at"),
    failedAt: timestamptz("failed_at"),
  },
  (table) => [
    unique("outbox_event_id_handler_key").on(table.eventId, table.handler),
    index("outbox_pending_available_at_idx")
      .on(table.availableAt)
      .where(sql`${table.status} = 'pending'`),
    index("outbox_failed_failed_at_idx")
      .on(table.failedAt.desc())
      .where(sql`${table.status} = 'failed'`),
    index("outbox_dispatched_at_idx")
      .on(table.dispatchedAt, table.id)
      .where(sql`${table.dispatchedAt} IS NOT NULL`),
    check("outbox_attempts_not_negative", sql`${table.attempts} >= 0`),
    check(
      "outbox_dispatched_at_when_dispatched",
      sql`(${table.status} = 'dispatched') = (${table.dispatchedAt} IS NOT NULL)`
    ),
    check(
      "outbox_failed_at_when_failed",
      sql`(${table.status} = 'failed') = (${table.failedAt} IS NOT NULL AND ${table.lastError} IS NOT NULL)`
    ),
  ]
);

export type OutboxRow = typeof outbox.$inferSelect;
