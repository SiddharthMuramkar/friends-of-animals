// Sign-in defaults from #55 (HR-19). #62's runtime settings may override
// them later; until then they live here.

/** Sign-in codes, by email and by SMS alike. */
export const SIGN_IN_CODE = {
  /** Digits in a code. */
  length: 6,
  /** How long a code works. */
  lifetimeMinutes: 10,
  /** Wrong guesses a code survives; the next try is refused. */
  attempts: 5,
} as const;

/** Limits on sign-in codes, by email and by SMS alike. */
export const CODE_REQUEST_LIMITS = {
  windowMinutes: 15,
  /** Codes per email address, or per phone number, per window. */
  perRecipient: 5,
  /**
   * Codes per IP network (ipNetwork) per window, email and SMS together.
   */
  perIp: 20,
  /**
   * Codes per email address or phone number per day (midnight to midnight
   * UTC). Each code allows `SIGN_IN_CODE.attempts` guesses, so this caps
   * guesses at one address or phone at 100 a day, not about 2,400, and
   * texts to one phone at 20 a day. FOA's own default beside HR-19.
   */
  perRecipientPerDay: 20,
  /**
   * Sign-in texts per hour, and per day (midnight to midnight UTC), to
   * everyone together: a ceiling on FOA's SMS bill, which the limits
   * above don't set (a pool of IP networks could text thousands of
   * numbers). FOA's own defaults, for the owner to confirm (HR-14). Staff
   * can change them as the settings `sms.maxPerHour` and `sms.maxPerDay`.
   */
  smsPerHour: 200,
  smsPerDay: 1000,
} as const;

/**
 * How long a session lasts from sign-in. It is absolute: using the site
 * doesn't extend it.
 */
export const SESSION_LIFETIME_DAYS = 30;
