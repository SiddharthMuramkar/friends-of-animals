// Runtime settings (#62). One row per setting a super admin has set; a
// setting without a row has its default (src/server/modules/settings/catalogue.ts).
// `value` is whatever the setting's schema allows, so it is jsonb, checked
// by the settings module on every write and read. The audit log keeps the
// history of changes.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./identity";

export const setting = pgTable("setting", {
  /** `<group>.<name>`, e.g. `auth.staffSessionHours`. */
  key: text().primaryKey(),
  value: jsonb().notNull(),
  /** Null for seed data, or once the changing user's account is gone. */
  updatedByUserId: uuid("updated_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type Setting = typeof setting.$inferSelect;
