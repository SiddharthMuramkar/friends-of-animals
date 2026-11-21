// Session lifetimes per role: staff sessions are shorter than member ones.
// A session lives at most `lifetime(roles)` from sign-in. The one rule
// covers a new session, a refresh (which would otherwise push the expiry
// out again) and a staff role granted to someone already signed in.
//
// The defaults are the settings defaults (HR-19); the runtime settings
// screen (#62) passes stored values instead. Pure: no I/O.

import { isStaffRole } from "./gate";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type SessionLifetimes = { memberMs: number; staffMs: number };

export const SESSION_LIFETIME_DEFAULTS: SessionLifetimes = {
  memberMs: 30 * DAY,
  staffMs: 12 * HOUR,
};

/** How long a session may last for a user holding `roles`. */
export function sessionLifetimeMs(
  roles: readonly string[],
  lifetimes: SessionLifetimes = SESSION_LIFETIME_DEFAULTS
): number {
  return roles.some(isStaffRole) ? lifetimes.staffMs : lifetimes.memberMs;
}

type SessionTimes = {
  createdAt: Date;
  /** The expiry stored or proposed for the session. */
  expiresAt: Date;
  roles: readonly string[];
  lifetimes?: SessionLifetimes;
};

/** The expiry to store: `expiresAt`, or sooner if the roles demand it. */
export function capSessionExpiry(session: SessionTimes): Date {
  const cap =
    session.createdAt.getTime() +
    sessionLifetimeMs(session.roles, session.lifetimes);
  return new Date(Math.min(session.expiresAt.getTime(), cap));
}

/** Whether the session still signs its user in at `now`. */
export function isSessionLive(session: SessionTimes & { now: Date }): boolean {
  return session.now.getTime() < capSessionExpiry(session).getTime();
}
