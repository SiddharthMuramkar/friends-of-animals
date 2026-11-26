// A certificate's type, its validity machine and its render machine. Pure:
// no imports, so the schema file (which loads under plain Node) can build
// its pgEnums from the tuples below.
//
// Every value the module will ever need is declared now, because adding an
// enum value later and using it in the same migration run fails. That is
// why `volunteer_service` is here before #124 issues one.
//
// Validity and rendering are separate on purpose: a certificate is valid
// (and verifiable) the moment it is issued, whether or not worker-media
// has produced its PDF yet.

export const CERTIFICATE_TYPES = [
  "participation",
  "school_merit",
  "finalist",
  "winner",
  "runner_up",
  "volunteer_service",
] as const;

export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_STATUSES = [
  "issued",
  "revoked",
  "superseded",
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const CERTIFICATE_RENDER_STATUSES = [
  "pending",
  "rendered",
  "failed",
] as const;

export type CertificateRenderStatus =
  (typeof CERTIFICATE_RENDER_STATUSES)[number];

type Transition<S> = {
  /** `null` is a certificate that does not exist yet. */
  from: S | null;
  to: S;
};

/** Every allowed validity move. Anything not listed is forbidden. */
export const CERTIFICATE_TRANSITIONS: readonly Transition<CertificateStatus>[] =
  [
    { from: null, to: "issued" },
    // Revoking and reissuing are #101's use cases; both end the old
    // certificate for good.
    { from: "issued", to: "revoked" },
    { from: "issued", to: "superseded" },
  ];

/** Every allowed render move. Anything not listed is forbidden. */
export const RENDER_TRANSITIONS: readonly Transition<CertificateRenderStatus>[] =
  [
    { from: null, to: "pending" },
    { from: "pending", to: "rendered" },
    { from: "pending", to: "failed" },
    // Staff retry a failed render.
    { from: "failed", to: "pending" },
  ];

export function canTransitionCertificate(
  from: CertificateStatus | null,
  to: CertificateStatus
): boolean {
  return CERTIFICATE_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

/** Thrown when a use case tries a validity move the machine forbids. */
export class CertificateTransitionError extends Error {
  readonly from: CertificateStatus | null;
  readonly to: CertificateStatus;

  constructor(from: CertificateStatus | null, to: CertificateStatus) {
    super(`A certificate cannot move ${from ?? "(none)"} -> ${to}`);
    this.name = "CertificateTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Throws `CertificateTransitionError` unless the move is allowed. */
export function assertCertificateTransition(
  from: CertificateStatus | null,
  to: CertificateStatus
): void {
  if (!canTransitionCertificate(from, to)) {
    throw new CertificateTransitionError(from, to);
  }
}

/** Whether verification should call a certificate in `status` valid. */
export function isCertificateValid(status: CertificateStatus): boolean {
  return status === "issued";
}

export function canTransitionRender(
  from: CertificateRenderStatus | null,
  to: CertificateRenderStatus
): boolean {
  return RENDER_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

/** Thrown when the render handler or a retry tries a forbidden move. */
export class RenderTransitionError extends Error {
  readonly from: CertificateRenderStatus | null;
  readonly to: CertificateRenderStatus;

  constructor(
    from: CertificateRenderStatus | null,
    to: CertificateRenderStatus
  ) {
    super(`A certificate's PDF cannot move ${from ?? "(none)"} -> ${to}`);
    this.name = "RenderTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Throws `RenderTransitionError` unless the move is allowed. */
export function assertRenderTransition(
  from: CertificateRenderStatus | null,
  to: CertificateRenderStatus
): void {
  if (!canTransitionRender(from, to)) {
    throw new RenderTransitionError(from, to);
  }
}

export type RenderFailureOutcome = {
  /** The attempts made so far, this one included. */
  attempts: number;
  status: "pending" | "failed";
  /** Whether the job should be tried again later. */
  shouldRequeue: boolean;
};

/**
 * What a failed render attempt leads to: another try while attempts remain,
 * otherwise `failed`, which only a staff retry leaves.
 */
export function afterRenderFailure({
  attempts,
  maxAttempts,
}: {
  /** Attempts made before this one. */
  attempts: number;
  maxAttempts: number;
}): RenderFailureOutcome {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      `maxAttempts must be a whole number of at least 1, not ${maxAttempts}`
    );
  }
  const made = attempts + 1;
  return made >= maxAttempts
    ? { attempts: made, status: "failed", shouldRequeue: false }
    : { attempts: made, status: "pending", shouldRequeue: true };
}
