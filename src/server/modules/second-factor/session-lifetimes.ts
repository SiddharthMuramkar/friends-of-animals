// Session lifetimes per role (HR-19 defaults): a staff member's session
// lasts 12 hours from sign-in, anyone else's 30 days. Enforced three ways,
// so no path stretches a staff session:
//   - a new session's stored expiry is capped (Better Auth's create hook);
//   - granting a staff role caps the grantee's live sessions;
//   - resolving the actor checks the cap again, whatever is stored.
// Loads under plain Node: relative imports only.

import { eq, sql } from "drizzle-orm";

import { grantsOf } from "../../access/grants";
import type { AppDb } from "../../db/app-db";
import { session } from "../../db/schema";
import { capSessionExpiry, isSessionLive } from "./domain/session-lifetime";
import { SECOND_FACTOR_SETTINGS } from "./settings";

type SessionTimes = { userId: string; createdAt: Date; expiresAt: Date };

async function rolesOf(db: AppDb, userId: string) {
  return (await grantsOf(db, userId)).map((grant) => grant.role);
}

/** The expiry to store for a new session: sooner for staff. */
export async function cappedSessionExpiry(
  db: AppDb,
  times: SessionTimes
): Promise<Date> {
  return capSessionExpiry({
    ...times,
    roles: await rolesOf(db, times.userId),
    lifetimes: SECOND_FACTOR_SETTINGS.sessionLifetimes,
  });
}

/** Whether the session may still sign its user in at `now`. */
export async function isLiveSession(
  db: AppDb,
  times: SessionTimes,
  now: Date
): Promise<boolean> {
  return isSessionLive({
    ...times,
    now,
    roles: await rolesOf(db, times.userId),
    lifetimes: SECOND_FACTOR_SETTINGS.sessionLifetimes,
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
  const seconds = SECOND_FACTOR_SETTINGS.sessionLifetimes.staffMs / 1000;
  await tx
    .update(session)
    .set({
      expiresAt: sql`least(${session.expiresAt}, ${session.createdAt} + make_interval(secs => ${seconds}))`,
    })
    .where(eq(session.userId, userId));
}
