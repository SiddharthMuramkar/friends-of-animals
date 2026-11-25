import { describe, expect, it } from "vitest";

import {
  afterRenderFailure,
  assertCertificateTransition,
  assertRenderTransition,
  canTransitionCertificate,
  canTransitionRender,
  CERTIFICATE_RENDER_STATUSES,
  CERTIFICATE_STATUSES,
  CERTIFICATE_TYPES,
  CertificateTransitionError,
  isCertificateValid,
  RenderTransitionError,
  type CertificateRenderStatus,
  type CertificateStatus,
} from "./status";

// The expected machines, written out by hand. A ticket that adds a
// transition adds its row here and in the module's table.
const ALLOWED: readonly (readonly [
  CertificateStatus | null,
  CertificateStatus,
])[] = [
  // Issued when results are published (or, for #124, when hours are approved).
  [null, "issued"],
  // Revoked with a reason, through #101's use case.
  ["issued", "revoked"],
  // Replaced by a reissued certificate with corrected details, through #101.
  ["issued", "superseded"],
];

const STATUSES: readonly CertificateStatus[] = [
  "issued",
  "revoked",
  "superseded",
];

const isAllowed = (from: CertificateStatus | null, to: CertificateStatus) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

const PAIRS = [null, ...STATUSES].flatMap((from) =>
  STATUSES.map((to) => ({ from, to, allowed: isAllowed(from, to) }))
);

describe("certificate types", () => {
  it("declares every type, including #124's volunteer certificate", () => {
    expect([...CERTIFICATE_TYPES]).toEqual([
      "participation",
      "school_merit",
      "finalist",
      "winner",
      "runner_up",
      "volunteer_service",
    ]);
  });
});

describe("certificate status machine", () => {
  it("declares every status a certificate will ever need", () => {
    expect([...CERTIFICATE_STATUSES]).toEqual(STATUSES);
  });

  it.each(PAIRS.filter((pair) => pair.allowed))(
    "allows $from -> $to",
    ({ from, to }) => {
      expect(canTransitionCertificate(from, to)).toBe(true);
      expect(() => assertCertificateTransition(from, to)).not.toThrow();
    }
  );

  it.each(PAIRS.filter((pair) => !pair.allowed))(
    "forbids $from -> $to",
    ({ from, to }) => {
      expect(canTransitionCertificate(from, to)).toBe(false);
      expect(() => assertCertificateTransition(from, to)).toThrow(
        CertificateTransitionError
      );
    }
  );

  it("names the refused move in the error", () => {
    const error = (() => {
      try {
        assertCertificateTransition("revoked", "issued");
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(CertificateTransitionError);
    expect(error).toMatchObject({ from: "revoked", to: "issued" });
    expect((error as Error).message).toBe(
      "A certificate cannot move revoked -> issued"
    );
  });

  it("calls only an issued certificate valid", () => {
    expect(isCertificateValid("issued")).toBe(true);
    expect(isCertificateValid("revoked")).toBe(false);
    expect(isCertificateValid("superseded")).toBe(false);
  });
});

const RENDER_ALLOWED: readonly (readonly [
  CertificateRenderStatus | null,
  CertificateRenderStatus,
])[] = [
  // Every new certificate waits for worker-media to render its PDF.
  [null, "pending"],
  ["pending", "rendered"],
  // Out of attempts. The certificate stays valid.
  ["pending", "failed"],
  // A staff member asks for another try.
  ["failed", "pending"],
];

const RENDER_STATUSES: readonly CertificateRenderStatus[] = [
  "pending",
  "rendered",
  "failed",
];

const isRenderAllowed = (
  from: CertificateRenderStatus | null,
  to: CertificateRenderStatus
) => RENDER_ALLOWED.some(([f, t]) => f === from && t === to);

const RENDER_PAIRS = [null, ...RENDER_STATUSES].flatMap((from) =>
  RENDER_STATUSES.map((to) => ({
    from,
    to,
    allowed: isRenderAllowed(from, to),
  }))
);

describe("certificate render machine", () => {
  it("declares every render status", () => {
    expect([...CERTIFICATE_RENDER_STATUSES]).toEqual(RENDER_STATUSES);
  });

  it.each(RENDER_PAIRS.filter((pair) => pair.allowed))(
    "allows $from -> $to",
    ({ from, to }) => {
      expect(canTransitionRender(from, to)).toBe(true);
      expect(() => assertRenderTransition(from, to)).not.toThrow();
    }
  );

  it.each(RENDER_PAIRS.filter((pair) => !pair.allowed))(
    "forbids $from -> $to",
    ({ from, to }) => {
      expect(canTransitionRender(from, to)).toBe(false);
      expect(() => assertRenderTransition(from, to)).toThrow(
        RenderTransitionError
      );
    }
  );
});

describe("afterRenderFailure", () => {
  it("counts the attempt and retries while attempts remain", () => {
    expect(afterRenderFailure({ attempts: 0, maxAttempts: 3 })).toEqual({
      attempts: 1,
      status: "pending",
      shouldRequeue: true,
    });
    expect(afterRenderFailure({ attempts: 1, maxAttempts: 3 })).toEqual({
      attempts: 2,
      status: "pending",
      shouldRequeue: true,
    });
  });

  it("gives up on the last attempt", () => {
    expect(afterRenderFailure({ attempts: 2, maxAttempts: 3 })).toEqual({
      attempts: 3,
      status: "failed",
      shouldRequeue: false,
    });
  });

  it("gives up at once when only one attempt is allowed", () => {
    expect(afterRenderFailure({ attempts: 0, maxAttempts: 1 })).toEqual({
      attempts: 1,
      status: "failed",
      shouldRequeue: false,
    });
  });

  it("refuses a limit below one attempt", () => {
    expect(() => afterRenderFailure({ attempts: 0, maxAttempts: 0 })).toThrow(
      RangeError
    );
  });
});
