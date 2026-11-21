// Scoped roles (#59). A grant is one row: a user holds one role at one
// scope, either global or one institution, competition or organisation.
// Revoking deletes the row; the audit log keeps the history.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { ROLES, SCOPE_TYPES } from "../../access/domain/roles";
import { user } from "./identity";

/** A later role (a verifier, a grievance officer) adds its value in its own migration. */
export const roleEnum = pgEnum("role", ROLES);

export const roleScopeTypeEnum = pgEnum("role_scope_type", SCOPE_TYPES);

export const userRole = pgTable(
  "user_role",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    scopeType: roleScopeTypeEnum("scope_type").notNull(),
    /**
     * The institution, competition or organisation; null for a global
     * grant. No foreign key: it points at a different table per scope type,
     * and those tables arrive with later tickets.
     */
    scopeId: uuid("scope_id"),
    /** Null for seed data, or once the granting user's account is gone. */
    grantedByUserId: uuid("granted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // A global grant has no scope id; every other grant has one.
    check(
      "user_role_scope_id_matches_type",
      sql`(${table.scopeType} = 'global') = (${table.scopeId} IS NULL)`
    ),
    // One row per grant. NULLS NOT DISTINCT makes two global grants of
    // one role (scope id null) collide too.
    unique("user_role_grant_unique")
      .on(table.userId, table.role, table.scopeType, table.scopeId)
      .nullsNotDistinct(),
    index("user_role_role_idx").on(table.role),
  ]
);

export type UserRole = typeof userRole.$inferSelect;
