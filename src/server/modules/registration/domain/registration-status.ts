// The registration status machine (#75): the statuses a participant's
// registration for a competition can have, and who may move it between
// them. #75 brought the school route's enrolled and withdrawn; #77 adds
// confirmed, once its fee is paid (or it is free); #78 adds an adult's own
// registration waiting for its fee; #81 a minor's, waiting for their
// guardian; #80 refunded and cancelled. Later tickets append theirs and
// their rows here, each new enum value in its own migration.
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
  /** Its fee went back to the payer (#80): no longer registered. */
  "refunded",
  /**
   * A minor's registration, held until a guardian has verified and
   * accepted them (#81): it can't be paid for or confirmed until then.
   */
  "pending_guardian",
  /** Its competition was cancelled before it was paid, or it was free
   * (#80). A paid one becomes refunded once its fee is back. */
  "cancelled",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * Who makes a move: the institution's coordinator or authorised person,
 * the adult registering themselves, the payments module once the fee is
 * captured or found to be zero, a verified guardian accepting the minor
 * (#81), or the competition's cancellation (#80).
 */
export type RegistrationCause =
  | "coordinator"
  | "participant"
  | "payment"
  | "guardian"
  | "cancellation";

/**
 * How a registration enters the machine on each route: the status it
 * usually starts in, any other it may start in, and who creates it. A
 * minor's individual registration starts held for their guardian when
 * none has verified yet (#81).
 */
const ENTRY: {
  readonly [Route in "institution" | "individual"]: {
    status: RegistrationStatus;
    alsoStartsIn: readonly RegistrationStatus[];
    cause: RegistrationCause;
  };
} = {
  institution: { status: "enrolled", alsoStartsIn: [], cause: "coordinator" },
  individual: {
    status: "pending_payment",
    alsoStartsIn: ["pending_guardian"],
    cause: "participant",
  },
};

/**
 * The allowed moves and their causes. A pair that is missing is forbidden
 * for everyone.
 */
const TRANSITIONS: {
  readonly [From in RegistrationStatus]: Partial<
    Record<RegistrationStatus, readonly RegistrationCause[]>
  >;
} = {
  enrolled: {
    withdrawn: ["coordinator"],
    confirmed: ["payment"],
    cancelled: ["cancellation"],
  },
  // A refund that lists it moves it, once the money is back (#80). A free
  // one is cancelled with its competition.
  confirmed: { refunded: ["payment"], cancelled: ["cancellation"] },
  withdrawn: {},
  // Withdrawing an unpaid registration of one's own waits for a later
  // ticket. Payment and competition cancellation can move it.
  pending_payment: { confirmed: ["payment"], cancelled: ["cancellation"] },
  refunded: {},
  // Guardian consent or a participant reaching adulthood can release it.
  // A guardian can withdraw a duplicate held place.
  pending_guardian: {
    pending_payment: ["guardian", "participant"],
    withdrawn: ["guardian"],
    cancelled: ["cancellation"],
  },
  cancelled: {},
};

/** The status a new registration usually starts in, and who creates it. */
export function initialRegistrationStatus(route: keyof typeof ENTRY): {
  status: RegistrationStatus;
  cause: RegistrationCause;
} {
  const { status, cause } = ENTRY[route];
  return { status, cause };
}

/** Whether a new registration on `route` may start in `status`. */
export function canStartIn(
  route: keyof typeof ENTRY,
  status: RegistrationStatus
): boolean {
  const entry = ENTRY[route];
  return entry.status === status || entry.alsoStartsIn.includes(status);
}

/** Whether `by` may move a registration from `from` to `to`. */
export function canTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
  by: RegistrationCause
): boolean {
  return transitionCauses(from, to).includes(by);
}

export function transitionCauses(
  from: RegistrationStatus,
  to: RegistrationStatus
): readonly RegistrationCause[] {
  return TRANSITIONS[from][to] ?? [];
}
