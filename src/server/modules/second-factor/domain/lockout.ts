// Counting failed second-factor attempts (sign-in second factor and
// step-up alike) and locking the user out for a while after too many, so
// six-digit codes can't be guessed. The count is per user, not per session,
// so signing in again doesn't reset it. While locked, attempts are refused
// without checking the code. Pure: the caller stores the state.

const MINUTE = 60 * 1000;

export type LockoutPolicy = {
  maxFailures: number;
  /** Failures older than this, counted from the first, are forgotten. */
  windowMs: number;
  lockMs: number;
};

/** HR-19 defaults, to be confirmed by FOA. */
export const LOCKOUT_DEFAULTS: LockoutPolicy = {
  maxFailures: 5,
  windowMs: 15 * MINUTE,
  lockMs: 15 * MINUTE,
};

export type LockoutState = {
  failures: number;
  /** When the first failure of the current count happened. */
  windowStartedAt: Date | null;
  lockedUntil: Date | null;
};

/** No failures and no lock: the state after a success, or for a new user. */
export const NO_FAILURES: LockoutState = {
  failures: 0,
  windowStartedAt: null,
  lockedUntil: null,
};

/** When the lock ends, or null if attempts are allowed at `now`. */
export function lockedUntil(state: LockoutState, now: Date): Date | null {
  return state.lockedUntil && now.getTime() < state.lockedUntil.getTime()
    ? state.lockedUntil
    : null;
}

/**
 * The state after a failed attempt at `now`. `lockedNow` is true when this
 * failure started a lock: the moment to write a lockout audit row.
 */
export function recordFailure(
  state: LockoutState,
  now: Date,
  policy: LockoutPolicy = LOCKOUT_DEFAULTS
): { state: LockoutState; lockedNow: boolean } {
  if (lockedUntil(state, now)) return { state, lockedNow: false };
  const windowOpen =
    state.windowStartedAt !== null &&
    now.getTime() - state.windowStartedAt.getTime() <= policy.windowMs;
  const failures = windowOpen ? state.failures + 1 : 1;
  if (failures >= policy.maxFailures) {
    return {
      state: {
        ...NO_FAILURES,
        lockedUntil: new Date(now.getTime() + policy.lockMs),
      },
      lockedNow: true,
    };
  }
  return {
    state: {
      failures,
      windowStartedAt: windowOpen ? state.windowStartedAt : now,
      lockedUntil: null,
    },
    lockedNow: false,
  };
}
