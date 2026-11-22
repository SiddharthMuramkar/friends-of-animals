// Staff two-factor authentication (#60). A user's second factors (an
// authenticator app or a passkey), which sessions have passed one and when,
// the lockout after failed codes, and WebAuthn challenges in flight.
//
// Loads under plain Node (drizzle-kit, the seed script): relative imports
// only, no "server-only".

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { session, user } from "./identity";

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const SECOND_FACTOR_KINDS = ["totp", "passkey"] as const;

export type SecondFactorKind = (typeof SECOND_FACTOR_KINDS)[number];

export const secondFactorKindEnum = pgEnum(
  "second_factor_kind",
  SECOND_FACTOR_KINDS
);

/**
 * One authenticator app (TOTP) or passkey. A TOTP factor is pending, and
 * counts for nothing, until its first code confirms it.
 */
export const secondFactor = pgTable(
  "second_factor",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: secondFactorKindEnum().notNull(),
    /** The name its owner gave it, shown on the security page. */
    label: text().notNull(),
    /** Null while a TOTP factor waits for its first code. */
    confirmedAt: timestamptz("confirmed_at"),
    /** The TOTP shared secret, sealed (src/server/modules/second-factor/secret-box.ts). */
    totpSecretSealed: text("totp_secret_sealed"),
    /** The time step of the last accepted code, so a code works once. */
    totpLastUsedStep: bigint("totp_last_used_step", { mode: "number" }),
    /** The passkey's credential id, base64url. */
    credentialId: text("credential_id").unique(),
    /** The passkey's COSE public key, base64url. */
    publicKey: text("public_key"),
    signCount: bigint("sign_count", { mode: "number" }),
    transports: text().array(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("second_factor_user_id_idx").on(table.userId),
    check(
      "second_factor_totp_fields",
      sql`${table.kind} <> 'totp' OR (${table.totpSecretSealed} IS NOT NULL AND ${table.credentialId} IS NULL AND ${table.publicKey} IS NULL)`
    ),
    check(
      "second_factor_passkey_fields",
      sql`${table.kind} <> 'passkey' OR (${table.credentialId} IS NOT NULL AND ${table.publicKey} IS NOT NULL AND ${table.signCount} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL AND ${table.totpSecretSealed} IS NULL)`
    ),
  ]
);

export type SecondFactorRow = typeof secondFactor.$inferSelect;

/**
 * When a session last passed a second factor. Step-up compares this with
 * the clock; the staff gate only needs it to exist.
 */
export const sessionSecondFactor = pgTable("session_second_factor", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  verifiedAt: timestamptz("verified_at").notNull(),
  method: secondFactorKindEnum().notNull(),
});

/**
 * Failed second-factor codes per user, and the lock they lead to. Per user,
 * not per session, so signing in again doesn't reset the count.
 */
export const secondFactorLockout = pgTable("second_factor_lockout", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  failures: integer().notNull(),
  windowStartedAt: timestamptz("window_started_at"),
  lockedUntil: timestamptz("locked_until"),
});

export const WEBAUTHN_PURPOSES = ["register", "verify"] as const;

export type WebauthnPurpose = (typeof WEBAUTHN_PURPOSES)[number];

/** The challenge a session's passkey ceremony must sign, until it expires. */
export const webauthnChallenge = pgTable(
  "webauthn_challenge",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    purpose: text({ enum: WEBAUTHN_PURPOSES }).notNull(),
    challenge: text().notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.purpose] })]
);
