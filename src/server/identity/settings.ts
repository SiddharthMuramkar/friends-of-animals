// Sign-in defaults from #55 (HR-19). #62's runtime settings may override
// them later; until then they live here.

export const EMAIL_CODE = {
  /** Digits in a code. */
  length: 6,
  /** How long a code works. */
  lifetimeMinutes: 10,
  /** Wrong guesses a code survives; the next try is refused. */
  attempts: 5,
} as const;

export const CODE_REQUEST_LIMITS = {
  windowMinutes: 15,
  /** Codes per email address per window. */
  perEmail: 5,
  /** Codes per IP network (ipNetwork) per window. */
  perIp: 20,
  /**
   * Codes per email address per day (midnight to midnight UTC). Each code
   * allows `EMAIL_CODE.attempts` guesses, so this caps guesses at one
   * address at 100 a day, not about 2,400. FOA's own default beside HR-19.
   */
  perEmailPerDay: 20,
} as const;

/**
 * How long a session lasts from sign-in. It is absolute: using the site
 * doesn't extend it.
 */
export const SESSION_LIFETIME_DAYS = 30;
