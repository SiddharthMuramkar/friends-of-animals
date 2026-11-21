// Second-factor defaults (HR-19, to be confirmed by FOA). The runtime
// settings screen (#62) may bind stored values to these later; until then
// they live here. Loads under plain Node: relative imports only.

import { STEP_UP_WINDOW_MS } from "./domain/gate";
import { LOCKOUT_DEFAULTS } from "./domain/lockout";
import { SESSION_LIFETIME_DEFAULTS } from "./domain/session-lifetime";

export const SECOND_FACTOR_SETTINGS = {
  /** The name authenticator apps show beside the account. */
  issuer: "Friends of Animals",
  /** How long a passed second factor counts for a sensitive action. */
  stepUpWindowMs: STEP_UP_WINDOW_MS,
  /** 5 failed codes in 15 minutes lock the user out for 15 minutes. */
  lockout: LOCKOUT_DEFAULTS,
  /**
   * Everyone else's sessions last 30 days from sign-in. Staff sessions
   * last the auth.staffSessionHours runtime setting (#62) instead.
   */
  sessionLifetimes: SESSION_LIFETIME_DEFAULTS,
  /** How long a passkey challenge can be answered. */
  passkeyChallengeMs: 5 * 60 * 1000,
} as const;
