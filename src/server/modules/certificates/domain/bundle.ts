// A certificate bundle: one ZIP of an institution's certificates for one
// competition, which a coordinator asks for, a background job builds, and
// a signed link delivers. This file holds the bundle's status machine, how
// long it lives, what goes in it and what its files are called.
//
// Pure: no imports, so the schema file (which loads under plain Node) can
// build its pgEnum from the tuple below. Every status the bundle will ever
// need is declared now, because adding an enum value later and using it in
// the same migration run fails.

export const CERTIFICATE_BUNDLE_STATUSES = [
  "pending",
  "ready",
  "failed",
  "expired",
] as const;

export type CertificateBundleStatus =
  (typeof CERTIFICATE_BUNDLE_STATUSES)[number];

type Transition = {
  /** `null` is a bundle that does not exist yet. */
  from: CertificateBundleStatus | null;
  to: CertificateBundleStatus;
};

/** Every allowed move. Anything not listed is forbidden. */
export const BUNDLE_TRANSITIONS: readonly Transition[] = [
  { from: null, to: "pending" },
  { from: "pending", to: "ready" },
  // The job gave up after its retries, or nothing was left to bundle.
  { from: "pending", to: "failed" },
  // Its days ran out, or a certificate in it was revoked or reissued.
  { from: "ready", to: "expired" },
];

export function canTransitionBundle(
  from: CertificateBundleStatus | null,
  to: CertificateBundleStatus
): boolean {
  return BUNDLE_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to
  );
}

/** Thrown when a use case or job tries a move the machine forbids. */
export class BundleTransitionError extends Error {
  readonly from: CertificateBundleStatus | null;
  readonly to: CertificateBundleStatus;

  constructor(
    from: CertificateBundleStatus | null,
    to: CertificateBundleStatus
  ) {
    super(`A certificate bundle cannot move ${from ?? "(none)"} -> ${to}`);
    this.name = "BundleTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Throws `BundleTransitionError` unless the move is allowed. */
export function assertBundleTransition(
  from: CertificateBundleStatus | null,
  to: CertificateBundleStatus
): void {
  if (!canTransitionBundle(from, to)) {
    throw new BundleTransitionError(from, to);
  }
}

/** How long a ready bundle can be downloaded before it is deleted. */
export const BUNDLE_LIFETIME_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a bundle that became ready at `readyAt` expires. */
export function bundleExpiresAt(readyAt: Date): Date {
  return new Date(readyAt.getTime() + BUNDLE_LIFETIME_DAYS * DAY_MS);
}

type BundleTiming = {
  status: CertificateBundleStatus;
  /** Set when the bundle became ready. */
  expiresAt: Date | null;
};

/**
 * The status as of `now`. A ready bundle whose time is up reads as expired
 * even if the expiry job hasn't run yet, so a late job never extends a
 * download.
 */
export function bundleStatusAt(
  bundle: BundleTiming,
  now: Date
): CertificateBundleStatus {
  if (
    bundle.status === "ready" &&
    bundle.expiresAt !== null &&
    bundle.expiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return bundle.status;
}

/** The longest a signed download link lives. */
export const BUNDLE_LINK_MAX_SECONDS = 300;

/**
 * How many seconds a signed link to the bundle may live: five minutes at
 * most and never past the bundle's own expiry. `null` when the bundle
 * can't be downloaded now (not ready, expired, or under a second left).
 */
export function bundleLinkLifetimeSeconds(
  bundle: BundleTiming,
  now: Date
): number | null {
  if (bundleStatusAt(bundle, now) !== "ready" || bundle.expiresAt === null) {
    return null;
  }
  const left = Math.floor((bundle.expiresAt.getTime() - now.getTime()) / 1000);
  return left < 1 ? null : Math.min(left, BUNDLE_LINK_MAX_SECONDS);
}

/** The most certificates one bundle may hold. */
export const BUNDLE_MAX_CERTIFICATES = 1000;

/** A certificate that might go in a bundle, as the loader reads it. */
export type BundleCandidate = {
  certificateId: string;
  number: string;
  status: "issued" | "revoked" | "superseded";
  renderStatus: "pending" | "rendered" | "failed";
  pdfFileId: string | null;
};

export type BundleEntry = {
  certificateId: string;
  number: string;
  pdfFileId: string;
  /** The PDF's name inside the ZIP. */
  fileName: string;
};

export type BundlePlan =
  | {
      ok: true;
      /** In certificate-number order. */
      entries: BundleEntry[];
      /** Valid certificates left out because their PDF isn't ready. */
      notReady: number;
    }
  | {
      ok: false;
      reason: "nothing_to_bundle" | "too_many";
      notReady: number;
    };

// Matches a stored certificate number (see number.ts in this folder). It is
// repeated here so this file stands alone; a number that fails it never
// becomes a file name inside the ZIP.
const STORED_NUMBER = /^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * What goes in a bundle: every valid certificate whose PDF is stored,
 * named by its number and never by the person on it. Revoked and replaced
 * certificates are left out. Valid ones still rendering are counted, not
 * waited for, so one failed render never blocks a school's download.
 */
export function planBundle(
  candidates: readonly BundleCandidate[],
  {
    maxCertificates = BUNDLE_MAX_CERTIFICATES,
  }: { maxCertificates?: number } = {}
): BundlePlan {
  const entries = new Map<string, BundleEntry>();
  const waiting = new Set<string>();
  for (const candidate of candidates) {
    if (!STORED_NUMBER.test(candidate.number)) {
      throw new RangeError(
        `Not a stored certificate number: ${JSON.stringify(candidate.number)}`
      );
    }
    if (candidate.status !== "issued") continue;
    if (candidate.renderStatus !== "rendered" || candidate.pdfFileId === null) {
      waiting.add(candidate.certificateId);
      continue;
    }
    entries.set(candidate.certificateId, {
      certificateId: candidate.certificateId,
      number: candidate.number,
      pdfFileId: candidate.pdfFileId,
      fileName: `${candidate.number}.pdf`,
    });
  }
  const notReady = waiting.size;
  if (entries.size === 0) {
    return { ok: false, reason: "nothing_to_bundle", notReady };
  }
  if (entries.size > maxCertificates) {
    return { ok: false, reason: "too_many", notReady };
  }
  const sorted = [...entries.values()].sort((a, b) =>
    a.number < b.number ? -1 : a.number > b.number ? 1 : 0
  );
  return { ok: true, entries: sorted, notReady };
}

/** Letters, digits, `_` and `-`; anything else becomes one `-`. */
function safePart(code: string): string {
  return code
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The ZIP's download name, made of codes so it never carries a child's
 * name and stays safe on every operating system.
 */
export function bundleArchiveName({
  competitionCode,
  institutionCode,
}: {
  competitionCode: string;
  institutionCode: string;
}): string {
  const parts = ["FOA-certificates", competitionCode, institutionCode]
    .map(safePart)
    .filter((part) => part.length > 0);
  return `${parts.join("-")}.zip`;
}
