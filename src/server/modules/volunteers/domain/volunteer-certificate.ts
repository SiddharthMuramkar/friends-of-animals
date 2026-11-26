// When a volunteer's certificate request issues a new certificate (#124).
// Each volunteer-service certificate states the approved hours as of the
// day it was issued, so older ones stay valid as the total grows. A new
// one is issued only once more hours have been approved since the latest;
// asking again with the same total returns the latest one.
//
// Pure: the use case loads the approved total and the newest certificate
// that has not been superseded, then asks this function.

export type VolunteerCertificateDecision =
  | { kind: "nothing_to_certify" }
  | { kind: "existing"; certificateId: string }
  | { kind: "issue"; approvedMinutes: number };

export function decideVolunteerCertificate(input: {
  /** The volunteer's approved minutes now. */
  approvedMinutes: number;
  /** Their newest certificate that has not been superseded, if any. */
  latest: { certificateId: string; approvedMinutesSnapshot: number } | null;
}): VolunteerCertificateDecision {
  const { approvedMinutes, latest } = input;
  if (!Number.isInteger(approvedMinutes) || approvedMinutes < 0) {
    throw new RangeError(
      `Approved minutes are a whole number of at least 0, not ${approvedMinutes}`
    );
  }
  if (latest && approvedMinutes < latest.approvedMinutesSnapshot) {
    throw new RangeError(
      `Approved minutes went down from ${latest.approvedMinutesSnapshot} to ${approvedMinutes}; approved hours are final`
    );
  }
  if (latest && approvedMinutes === latest.approvedMinutesSnapshot) {
    return { kind: "existing", certificateId: latest.certificateId };
  }
  if (approvedMinutes === 0) return { kind: "nothing_to_certify" };
  return { kind: "issue", approvedMinutes };
}
