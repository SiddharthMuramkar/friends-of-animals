import { describe, expect, it } from "vitest";

import {
  assertBundleTransition,
  BUNDLE_LIFETIME_DAYS,
  BUNDLE_LINK_MAX_SECONDS,
  BUNDLE_MAX_CERTIFICATES,
  bundleArchiveName,
  bundleExpiresAt,
  bundleLinkLifetimeSeconds,
  bundleStatusAt,
  BundleTransitionError,
  canTransitionBundle,
  CERTIFICATE_BUNDLE_STATUSES,
  planBundle,
  type BundleCandidate,
  type CertificateBundleStatus,
} from "./bundle";

// The expected machine, written out by hand. A ticket that adds a
// transition adds its row here and in the module's table.
const ALLOWED: readonly (readonly [
  CertificateBundleStatus | null,
  CertificateBundleStatus,
])[] = [
  // A coordinator asks for the ZIP.
  [null, "pending"],
  // The job built and stored it.
  ["pending", "ready"],
  // The job gave up, or found nothing left to put in it.
  ["pending", "failed"],
  // Seven days passed, or a certificate in it was revoked or reissued.
  ["ready", "expired"],
];

const STATUSES: readonly CertificateBundleStatus[] = [
  "pending",
  "ready",
  "failed",
  "expired",
];

const isAllowed = (
  from: CertificateBundleStatus | null,
  to: CertificateBundleStatus
) => ALLOWED.some(([f, t]) => f === from && t === to);

const PAIRS = [null, ...STATUSES].flatMap((from) =>
  STATUSES.map((to) => ({ from, to, allowed: isAllowed(from, to) }))
);

describe("bundle status machine", () => {
  it("declares every status a bundle will ever need", () => {
    expect([...CERTIFICATE_BUNDLE_STATUSES]).toEqual(STATUSES);
  });

  it.each(PAIRS.filter((pair) => pair.allowed))(
    "allows $from -> $to",
    ({ from, to }) => {
      expect(canTransitionBundle(from, to)).toBe(true);
      expect(() => assertBundleTransition(from, to)).not.toThrow();
    }
  );

  it.each(PAIRS.filter((pair) => !pair.allowed))(
    "forbids $from -> $to",
    ({ from, to }) => {
      expect(canTransitionBundle(from, to)).toBe(false);
      expect(() => assertBundleTransition(from, to)).toThrow(
        BundleTransitionError
      );
    }
  );

  it("names both ends of a forbidden move", () => {
    const error = (() => {
      try {
        assertBundleTransition("expired", "ready");
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(BundleTransitionError);
    expect(error).toMatchObject({ from: "expired", to: "ready" });
    expect(String(error)).toContain("expired -> ready");
  });

  it("leaves failed and expired for good", () => {
    for (const to of STATUSES) {
      expect(canTransitionBundle("failed", to)).toBe(false);
      expect(canTransitionBundle("expired", to)).toBe(false);
    }
  });
});

describe("bundle expiry", () => {
  const readyAt = new Date("2027-03-01T04:30:00.000Z");

  it("keeps a ready bundle for seven days", () => {
    expect(BUNDLE_LIFETIME_DAYS).toBe(7);
    expect(bundleExpiresAt(readyAt).toISOString()).toBe(
      "2027-03-08T04:30:00.000Z"
    );
  });

  it("reads a ready bundle past its expiry as expired before the job runs", () => {
    const expiresAt = bundleExpiresAt(readyAt);
    const before = new Date(expiresAt.getTime() - 1);
    expect(bundleStatusAt({ status: "ready", expiresAt }, before)).toBe(
      "ready"
    );
    expect(bundleStatusAt({ status: "ready", expiresAt }, expiresAt)).toBe(
      "expired"
    );
  });

  it.each(["pending", "failed", "expired"] as const)(
    "leaves a %s bundle as it is",
    (status) => {
      expect(
        bundleStatusAt(
          { status, expiresAt: null },
          new Date("2030-01-01T00:00:00.000Z")
        )
      ).toBe(status);
    }
  );
});

describe("signed link lifetime", () => {
  const now = new Date("2027-03-01T04:30:00.000Z");
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it("is five minutes for a bundle with days left", () => {
    expect(BUNDLE_LINK_MAX_SECONDS).toBe(300);
    expect(
      bundleLinkLifetimeSeconds(
        { status: "ready", expiresAt: later(3 * 24 * 3600) },
        now
      )
    ).toBe(300);
  });

  it("never outlives the bundle", () => {
    expect(
      bundleLinkLifetimeSeconds({ status: "ready", expiresAt: later(42) }, now)
    ).toBe(42);
    expect(
      bundleLinkLifetimeSeconds(
        { status: "ready", expiresAt: new Date(now.getTime() + 1500) },
        now
      )
    ).toBe(1);
  });

  it("gives no link in the last second or after expiry", () => {
    expect(
      bundleLinkLifetimeSeconds(
        { status: "ready", expiresAt: new Date(now.getTime() + 999) },
        now
      )
    ).toBeNull();
    expect(
      bundleLinkLifetimeSeconds({ status: "ready", expiresAt: now }, now)
    ).toBeNull();
    expect(
      bundleLinkLifetimeSeconds({ status: "ready", expiresAt: later(-60) }, now)
    ).toBeNull();
  });

  it.each(["pending", "failed", "expired"] as const)(
    "gives no link for a %s bundle",
    (status) => {
      expect(
        bundleLinkLifetimeSeconds({ status, expiresAt: later(3600) }, now)
      ).toBeNull();
    }
  );

  it("gives no link for a ready bundle without an expiry", () => {
    expect(
      bundleLinkLifetimeSeconds({ status: "ready", expiresAt: null }, now)
    ).toBeNull();
  });
});

describe("planBundle", () => {
  let next = 0;
  const candidate = (
    details: Partial<BundleCandidate> & { number: string }
  ): BundleCandidate => {
    next += 1;
    return {
      certificateId: `certificate-${next}`,
      status: "issued",
      renderStatus: "rendered",
      pdfFileId: `file-${next}`,
      ...details,
    };
  };

  it("puts every valid, rendered certificate in, in number order", () => {
    const b = candidate({ number: "FOA-C-27-BBBBBBBBBB" });
    const a = candidate({ number: "FOA-C-27-AAAAAAAAAA" });
    const plan = planBundle([b, a]);
    expect(plan).toEqual({
      ok: true,
      entries: [
        {
          certificateId: a.certificateId,
          number: a.number,
          pdfFileId: a.pdfFileId,
          fileName: "FOA-C-27-AAAAAAAAAA.pdf",
        },
        {
          certificateId: b.certificateId,
          number: b.number,
          pdfFileId: b.pdfFileId,
          fileName: "FOA-C-27-BBBBBBBBBB.pdf",
        },
      ],
      notReady: 0,
    });
  });

  it("leaves out revoked and replaced certificates without counting them", () => {
    const plan = planBundle([
      candidate({ number: "FOA-C-27-AAAAAAAAAA" }),
      candidate({ number: "FOA-C-27-BBBBBBBBBB", status: "revoked" }),
      candidate({ number: "FOA-C-27-CCCCCCCCCC", status: "superseded" }),
    ]);
    expect(plan.ok && plan.entries.map((entry) => entry.number)).toEqual([
      "FOA-C-27-AAAAAAAAAA",
    ]);
    expect(plan.notReady).toBe(0);
  });

  it("counts valid certificates whose PDF isn't ready instead of waiting", () => {
    const plan = planBundle([
      candidate({ number: "FOA-C-27-AAAAAAAAAA" }),
      candidate({ number: "FOA-C-27-BBBBBBBBBB", renderStatus: "pending" }),
      candidate({ number: "FOA-C-27-CCCCCCCCCC", renderStatus: "failed" }),
      // Rendered but the file is missing: treated as not ready, never as a
      // ZIP entry without bytes.
      candidate({ number: "FOA-C-27-DDDDDDDDDD", pdfFileId: null }),
    ]);
    expect(plan.ok && plan.entries.map((entry) => entry.number)).toEqual([
      "FOA-C-27-AAAAAAAAAA",
    ]);
    expect(plan.notReady).toBe(3);
  });

  it("refuses a bundle with nothing to put in it, and says what is waiting", () => {
    expect(planBundle([])).toEqual({
      ok: false,
      reason: "nothing_to_bundle",
      notReady: 0,
    });
    expect(
      planBundle([
        candidate({ number: "FOA-C-27-AAAAAAAAAA", status: "revoked" }),
        candidate({ number: "FOA-C-27-BBBBBBBBBB", renderStatus: "pending" }),
      ])
    ).toEqual({ ok: false, reason: "nothing_to_bundle", notReady: 1 });
  });

  it("lists a certificate once even if it is passed twice", () => {
    const a = candidate({ number: "FOA-C-27-AAAAAAAAAA" });
    const plan = planBundle([a, { ...a }]);
    expect(plan.ok && plan.entries).toHaveLength(1);
  });

  it("refuses more certificates than one bundle may hold", () => {
    expect(BUNDLE_MAX_CERTIFICATES).toBe(1000);
    const three = ["AAAAAAAAAA", "BBBBBBBBBB", "CCCCCCCCCC"].map((code) =>
      candidate({ number: `FOA-C-27-${code}` })
    );
    expect(planBundle(three, { maxCertificates: 2 })).toEqual({
      ok: false,
      reason: "too_many",
      notReady: 0,
    });
    expect(planBundle(three, { maxCertificates: 3 }).ok).toBe(true);
  });

  it("refuses an entry whose number isn't a stored certificate number", () => {
    // File names come from numbers, so a bad one must never reach the ZIP.
    expect(() =>
      planBundle([candidate({ number: "../../etc/passwd" })])
    ).toThrow(RangeError);
  });
});

describe("bundleArchiveName", () => {
  it("names the ZIP by codes, never by people", () => {
    expect(
      bundleArchiveName({
        competitionCode: "FOA-2027-ART",
        institutionCode: "SCH-0042",
      })
    ).toBe("FOA-certificates-FOA-2027-ART-SCH-0042.zip");
  });

  it("keeps only safe characters", () => {
    expect(
      bundleArchiveName({
        competitionCode: "art/2027 ..\\junior",
        institutionCode: "  sch:42  ",
      })
    ).toBe("FOA-certificates-art-2027-junior-sch-42.zip");
  });

  it("drops a code that has no safe characters", () => {
    expect(
      bundleArchiveName({ competitionCode: "ART27", institutionCode: "///" })
    ).toBe("FOA-certificates-ART27.zip");
  });
});
