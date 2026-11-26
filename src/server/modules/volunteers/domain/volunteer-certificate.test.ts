import { describe, expect, it } from "vitest";

import { decideVolunteerCertificate } from "./volunteer-certificate";

describe("decideVolunteerCertificate", () => {
  it("has nothing to certify before any hours are approved", () => {
    expect(
      decideVolunteerCertificate({ approvedMinutes: 0, latest: null })
    ).toEqual({ kind: "nothing_to_certify" });
  });

  it("issues the first certificate for the approved total", () => {
    expect(
      decideVolunteerCertificate({ approvedMinutes: 750, latest: null })
    ).toEqual({ kind: "issue", approvedMinutes: 750 });
  });

  it("returns the latest certificate while the total is unchanged", () => {
    // Requesting twice, or a retried request, gives one certificate.
    expect(
      decideVolunteerCertificate({
        approvedMinutes: 750,
        latest: { certificateId: "cert-1", approvedMinutesSnapshot: 750 },
      })
    ).toEqual({ kind: "existing", certificateId: "cert-1" });
  });

  it("issues a new certificate once more hours are approved", () => {
    // The older one stays valid: it still truly states its total.
    expect(
      decideVolunteerCertificate({
        approvedMinutes: 900,
        latest: { certificateId: "cert-1", approvedMinutesSnapshot: 750 },
      })
    ).toEqual({ kind: "issue", approvedMinutes: 900 });
  });

  it("refuses a total below the latest certificate's", () => {
    // Approved hours are final, so the total never goes down.
    expect(() =>
      decideVolunteerCertificate({
        approvedMinutes: 600,
        latest: { certificateId: "cert-1", approvedMinutesSnapshot: 750 },
      })
    ).toThrow(RangeError);
  });

  it.each([-1, 1.5, Number.NaN])("refuses a total of %d", (approvedMinutes) => {
    expect(() =>
      decideVolunteerCertificate({ approvedMinutes, latest: null })
    ).toThrow(RangeError);
  });
});
