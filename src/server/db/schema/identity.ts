// Identity and access (#57, #58). `user`, `session` and `verification` have
// the shapes Better Auth's core models expect (its Drizzle adapter maps them
// by these property names); FOA adds the user's phone, encrypted.
// `otp_rate_limit` is FOA's own: Better Auth limits only per IP and path,
// and FOA limits sign-in codes per email or phone and per IP. Ids are
// UUIDv7 made in the app (src/server/ids.ts).
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { encryptedText } from "../types/encrypted-text";

/**
 * A Postgres regex class for what never belongs in a stored address:
 * whitespace and control characters, and the Unicode spaces JavaScript's
 * trim() strips (no-break, en to hair, line and paragraph separators,
 * narrow no-break, medium mathematical, ideographic, zero-width no-break).
 */
const NOT_IN_AN_EMAIL =
  "[[:space:][:cntrl:]\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable(
  "user",
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    /**
     * Stored trimmed and lower-cased (normaliseEmailAddress); one account
     * per address. A check constraint holds every writer to that, Better
     * Auth included, so "Asha@x" can't sit next to "asha@x": lower case,
     * and no whitespace or control character anywhere (JavaScript's trim()
     * strips Unicode spaces that Postgres's btrim() keeps). Null for an
     * account made by phone, which has no address.
     */
    email: text().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    /**
     * The phone number (E.164, e.g. "+919876543210"), encrypted with the
     * field cipher for purpose "user.phone". Never readable in the table.
     */
    phoneCiphertext: encryptedText("phone_ciphertext"),
    /**
     * The phone's blind index, `blindIndex.of("user.phone", e164)`: how
     * sign-in finds the account by phone. One account per phone.
     */
    phoneHash: text("phone_hash").unique(),
    /** The phone received a sign-in code that was entered. */
    phoneVerified: boolean("phone_verified").notNull().default(false),
    image: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "user_email_normalised",
      sql`${table.email} = lower(${table.email}) AND ${table.email} !~ ${sql.raw(`'${NOT_IN_AN_EMAIL}'`)}`
    ),
    // Every account can be signed in to: it has an address or a phone.
    check(
      "user_email_or_phone",
      sql`${table.email} IS NOT NULL OR ${table.phoneHash} IS NOT NULL`
    ),
    // A phone is stored as both its ciphertext and its blind index.
    check(
      "user_phone_complete",
      sql`(${table.phoneCiphertext} IS NULL) = (${table.phoneHash} IS NULL)`
    ),
  ]
);

export type User = typeof user.$inferSelect;

/** A signed-in device or browser. The cookie holds `token`, signed. */
export const session = pgTable(
  "session",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expiresAt: timestamptz("expires_at").notNull(),
    /** The IP and browser the session was started from, shown to its user. */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

/**
 * Better Auth requires this table. Sign-in by email code never writes to it:
 * it holds credentials for other ways to sign in (OAuth, passwords), which
 * FOA doesn't use. A passkey or authenticator (#60) adds its own tables.
 */
export const account = pgTable(
  "account",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text(),
    password: text(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)]
);

/** Better Auth's one-time values: here, hashed sign-in codes. */
export const verification = pgTable(
  "verification",
  {
    id: uuid().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

/**
 * What a sign-in code limit counts by. Text checked against this list, not
 * a Postgres enum, so a new scope needs no migration.
 */
export const OTP_RATE_LIMIT_SCOPES = [
  "email",
  "ip",
  "email_day",
  "phone",
  "phone_day",
  // Texts to everyone together, under one fixed key.
  "sms_hour",
  "sms_day",
] as const;

export type OtpRateLimitScope = (typeof OTP_RATE_LIMIT_SCOPES)[number];

/**
 * Sign-in codes requested per email address, phone and IP in a fixed
 * window. Keys are HMACs, never the address, number or IP itself.
 */
export const otpRateLimit = pgTable(
  "otp_rate_limit",
  {
    scope: text({ enum: OTP_RATE_LIMIT_SCOPES }).notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    count: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash, table.windowStart] }),
    index("otp_rate_limit_window_start_idx").on(table.windowStart),
  ]
);
