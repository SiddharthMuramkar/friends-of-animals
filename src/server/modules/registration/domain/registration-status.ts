// The registration status machine (#75): the statuses a participant's
// registration for a competition can have, and who may move it between
// them. This ticket brings the school route's first two; later tickets
// append theirs (pending payment and confirmed with #77, refunded with
// #80, waiting for a guardian with #81) and their rows here, each new
// enum value in its own migration.
//
// Plain TypeScript with no imports, so the schema file and the seed
// script can load it under plain Node.

/** Every status, in the order a registration passes through them. */
export const REGISTRATION_STATUSES = ["enrolled", "withdrawn"] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Who makes a move: the institution's coordinator or authorised person. */
export type RegistrationCause = "coordinator";

/** How a registration enters the machine on each route. */
const ENTRY: {
  readonly institution: {
    status: RegistrationStatus;
    cause: RegistrationCause;
  };
} = {
  institution: { status: "enrolled", cause: "coordinator" },
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
  enrolled: { withdrawn: "coordinator" },
  withdrawn: {},
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
