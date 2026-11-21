// The audit log (#59): who did what to which record, when, from where, and
// what it looked like before and after. Append-only: a trigger refuses any
// UPDATE, DELETE or TRUNCATE, and no role but the owner holds those rights
// (drizzle/*_59_audit_append_only.sql), so not even the migrator can
// rewrite history.
//
// `before` and `after` hold ids and the fields that changed, never a whole
// row, so personal data stays out of a table nobody can edit.
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
  uuid,
} from "drizzle-orm/pg-core";

import { roleEnum } from "./access";

export const auditActorKindEnum = pgEnum("audit_actor_kind", [
  "visitor",
  "user",
  "system",
]);

export const AUDIT_ACTOR_PROCESSES = ["seed", "worker", "cli"] as const;

export const auditLog = pgTable(
  "audit_log",
  {
    /** UUIDv7 from the clock, so ids sort newest last. */
    id: uuid().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorKind: auditActorKindEnum("actor_kind").notNull(),
    /**
     * The acting user. No foreign key: ON DELETE SET NULL would update this
     * table, which the trigger refuses, and so block deleting the user.
     */
    actorUserId: uuid("actor_user_id"),
    /** The platform process, when the platform itself acted. */
    actorProcess: text("actor_process", { enum: AUDIT_ACTOR_PROCESSES }),
    /** The role that allowed the action; null when none was needed. */
    actorRole: roleEnum("actor_role"),
    /** `<entity>.<past-tense verb>`, e.g. `role.granted`. */
    action: text().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb(),
    after: jsonb(),
    /** The client IP and user agent, kept raw for forensics. */
    ip: text(),
    userAgent: text("user_agent"),
  },
  (table) => [
    check(
      "audit_log_actor_user_matches_kind",
      sql`(${table.actorKind} = 'user') = (${table.actorUserId} IS NOT NULL)`
    ),
    check(
      "audit_log_actor_process_matches_kind",
      sql`(${table.actorKind} = 'system') = (${table.actorProcess} IS NOT NULL)`
    ),
    // Searches filter by one of these and list newest first by id.
    index("audit_log_actor_user_id_idx").on(table.actorUserId, table.id.desc()),
    index("audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
      table.id.desc()
    ),
    index("audit_log_action_idx").on(table.action, table.id.desc()),
  ]
);

export type AuditLogRow = typeof auditLog.$inferSelect;
