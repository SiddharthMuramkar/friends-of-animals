import { describe, expect, it } from "vitest";

import { BREACH_AUDIT_ACTIONS, breachAuditSnapshot } from "./audit";

/** A breach as the database returns it, text and all. */
const breach = {
  id: "0194f3a2-7c00-7000-8000-000000000099",
  title: "Export file sent to the wrong school",
  impact: "Names and classes of 3 pupils at Sunrise School were visible.",
  status: "notified" as const,
  severity: "high" as const,
  personalDataInvolved: true,
  minorsAffected: true,
  affectedCount: 3,
  awareAt: new Date("2027-01-15T04:00:00.000Z"),
  containedAt: null,
  principalsNotifiedAt: new Date("2027-01-15T07:00:00.000Z"),
  authorityNotifiedAt: null,
  authorityReference: "DPB/2027/77",
  leadUserId: "0194f3a2-7c00-7000-8000-000000000001",
};

describe("breachAuditSnapshot", () => {
  it("keeps lifecycle fields, flags and counts", () => {
    expect(breachAuditSnapshot(breach)).toEqual({
      status: "notified",
      severity: "high",
      personalDataInvolved: true,
      minorsAffected: true,
      affectedCount: 3,
      containedAt: null,
      principalsNotifiedAt: "2027-01-15T07:00:00.000Z",
      authorityNotifiedAt: null,
    });
  });

  it("leaks no title, impact, reference or person", () => {
    const json = JSON.stringify(breachAuditSnapshot(breach));
    for (const secret of [
      breach.id,
      "wrong school",
      "Sunrise",
      "pupils",
      "DPB/2027",
      breach.leadUserId,
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("adds how many notices a change sent, when given", () => {
    expect(breachAuditSnapshot(breach, { noticesSent: 3 })).toMatchObject({
      noticesSent: 3,
    });
    expect(breachAuditSnapshot(breach)).not.toHaveProperty("noticesSent");
  });

  it("refuses a negative count", () => {
    expect(() =>
      breachAuditSnapshot({ ...breach, affectedCount: -1 })
    ).toThrow();
  });
});

describe("BREACH_AUDIT_ACTIONS", () => {
  it("names one action per change, all under breach.", () => {
    expect(new Set(BREACH_AUDIT_ACTIONS).size).toBe(
      BREACH_AUDIT_ACTIONS.length
    );
    for (const action of BREACH_AUDIT_ACTIONS) {
      expect(action).toMatch(/^breach\.[a-z_]+$/);
    }
  });
});
