// Session lifetimes per role: a staff member's session lasts the
// auth.staffSessionHours setting from sign-in (#62; 12 hours by default,
// HR-19), anyone else's 30 days. Enforced three ways, so no path stretches
// a staff session, and a lower setting ends older staff sessions at once:
//   - a new session's stored expiry is capped (Better Auth's create hook);
//   - granting a staff role caps the grantee's live sessions;
//   - resolving the actor checks the cap again, whatever is stored.
// Loads under plain Node: relative imports only.

import { eq, sql } from "drizzle-orm";

import { isStaffRole, type Role } from "../../access/domain/roles";
import { grantsOf } from "../../access/grants";
import type { AppDb } from "../../db/app-db";
import { session } from "../../db/schema";
import { readSetting } from "../settings/read";
import {
  capSessionExpiry,
  isSessionLive,
  type SessionLifetimes,
} from "./domain/session-lifetime";
import { SECOND_FACTOR_SETTINGS } from "./settings";

const HOUR_MS = 60 * 60 * 1000;

type SessionTimes = { userId: string; createdAt: Date; expiresAt: Date };

async function rolesOf(db: AppDb, userId: string) {
  return (await grantsOf(db, userId)).map((grant) => grant.role);
}

/** The staff lifetime as the settings say now. */
async function staffLifetimeMs(db: AppDb): Promise<number> {
  return (await readSetting(db, "auth.staffSessionHours")) * HOUR_MS;
}

/** The lifetimes that apply now, reading the setting only for staff. */
async function lifetimesFor(
  db: AppDb,
  roles: readonly Role[]
): Promise<SessionLifetimes> {
  const defaults = SECOND_FACTOR_SETTINGS.sessionLifetimes;
  return roles.some(isStaffRole)
    ? { ...defaults, staffMs: await staffLifetimeMs(db) }
    : defaults;
}

/** The expiry to store for a new session: sooner for staff. */
export async function cappedSessionExpiry(
  db: AppDb,
  times: SessionTimes
): Promise<Date> {
  const roles = await rolesOf(db, times.userId);
  return capSessionExpiry({
    ...times,
    roles,
    lifetimes: await lifetimesFor(db, roles),
  });
}

/** Whether the session may still sign its user in at `now`. */
export async function isLiveSession(
  db: AppDb,
  times: SessionTimes,
  now: Date
): Promise<boolean> {
  const roles = await rolesOf(db, times.userId);
  return isSessionLive({
    ...times,
    now,
    roles,
    lifetimes: await lifetimesFor(db, roles),
  });
}

/**
 * Caps every session of `userId` at sign-in plus the staff lifetime: for
 * someone just granted a staff role. A session already older ends.
 */
export async function capSessionsAtStaffLifetime(
  tx: AppDb,
  userId: string
): Promise<void> {
  const seconds = (await staffLifetimeMs(tx)) / 1000;
  await tx
    .update(session)
    .set({
      expiresAt: sql`least(${session.expiresAt}, ${session.createdAt} + make_interval(secs => ${seconds}))`,
    })
    .where(eq(session.userId, userId));
}
