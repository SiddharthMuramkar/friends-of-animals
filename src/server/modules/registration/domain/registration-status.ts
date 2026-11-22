// The registration status machine (#75): the statuses a participant's
// registration for a competition can have, and who may move it between
// them. #75 brought the school route's enrolled and withdrawn; #77 adds
// confirmed, once its fee is paid (or it is free); #78 adds an adult's own
// registration waiting for its fee; #81 a minor's, waiting for their
// guardian. Later tickets append theirs (refunded with #80) and their rows
// here, each new enum value in its own migration.
//
// Plain TypeScript with no imports, so the schema file and the seed
// script can load it under plain Node.

/** Every status, in the order a registration passes through them. */
export const REGISTRATION_STATUSES = [
  "enrolled",
  /** Paid in full, or free; it has its registration number (#77). */
  "confirmed",
  "withdrawn",
  /** An adult registered themselves and has not paid yet (#78). */
  "pending_payment",
  /**
   * A minor's registration, held until a guardian has verified and
   * accepted them (#81): it can't be paid for or confirmed until then.
   */
  "pending_guardian",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * Who makes a move: the institution's coordinator or authorised person,
 * the adult registering themselves, the payments module once the fee is
 * captured or found to be zero, or a verified guardian accepting the
 * minor (#81).
 */
export type RegistrationCause =
  | "coordinator"
  | "participant"
  | "payment"
  | "guardian";

/** How a registration enters the machine on each route. */
const ENTRY: {
  readonly [Route in "institution" | "individual"]: {
    status: RegistrationStatus;
    cause: RegistrationCause;
  };
} = {
  institution: { status: "enrolled", cause: "coordinator" },
  individual: { status: "pending_payment", cause: "participant" },
};

/**
 * The allowed moves, each with the one cause that may make it. A pair that
 * is missing is forbidden for everyone.
 */
const TRANSITIONS: {
  readonly [From in RegistrationStatus]: Partial<
    Record<RegistrationStatus, RegistrationCause>
  >;
} = {
  enrolled: { withdrawn: "coordinator", confirmed: "payment" },
  // Withdrawing a paid student waits for refunds (#80).
  confirmed: {},
  withdrawn: {},
  // Withdrawing an unpaid registration of one's own waits for a later
  // ticket; only the payment moves it.
  pending_payment: { confirmed: "payment" },
  // Only a verified guardian's acceptance releases it; nothing confirms it
  // directly, and nothing moves a registration back here.
  pending_guardian: { pending_payment: "guardian" },
};

/** The status a new registration starts in, and who creates it. */
export function initialRegistrationStatus(route: keyof typeof ENTRY): {
  status: RegistrationStatus;
  cause: RegistrationCause;
} {
  return ENTRY[route];
}

/** Who may move a registration from `from` to `to`, or null if nobody may. */
export function transitionCause(
  from: RegistrationStatus,
  to: RegistrationStatus
): RegistrationCause | null {
  return TRANSITIONS[from][to] ?? null;
}

/** Whether `by` may move a registration from `from` to `to`. */
export function canTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
  by: RegistrationCause
): boolean {
  return transitionCause(from, to) === by;
}
