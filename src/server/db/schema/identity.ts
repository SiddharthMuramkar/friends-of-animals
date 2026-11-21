// Identity and access (#57). The `user` table has the shape Better Auth's
// core user model expects (name, email, emailVerified, image, createdAt,
// updatedAt), so its Drizzle adapter can use it as is. Ids are UUIDv7 made
// in the app (src/server/ids.ts); times come from the injected clock.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    /**
     * Stored trimmed and lower-cased (normaliseEmailAddress); one account
     * per address. A check constraint holds every writer to that, Better
     * Auth included, so "Asha@x" can't sit next to "asha@x".
     */
    email: text().notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "user_email_normalised",
      sql`${table.email} = lower(btrim(${table.email}))`
    ),
  ]
);

export type User = typeof user.$inferSelect;
