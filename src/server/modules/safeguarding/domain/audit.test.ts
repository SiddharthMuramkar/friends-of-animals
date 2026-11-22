import { describe, expect, it } from "vitest";

import {
  SAFEGUARDING_AUDIT_ACTIONS,
  incidentLogEntryAuditSnapshot,
  queueViewAuditSnapshot,
  safeguardingReportAuditSnapshot,
} from "./audit";

const LEAD_ID = "0194f3a2-7c00-7000-8000-000000000001";
const ENTRY_ID = "0194f3a2-7c00-7000-8000-0000000000aa";

/** A report as the database returns it, content and all. */
const report = {
  id: "0194f3a2-7c00-7000-8000-000000000099",
  reference: "SG-27-8H3TZQ",
  status: "investigating" as const,
  severity: "high" as const,
  assignedToUserId: LEAD_ID,
  category: "suspected_abuse",
  description: "Pupil said her coach hit her",
  reporterName: "Asha Rao",
  reporterContact: "asha@example.test",
  subjectDetails: "Class 6, Pune",
  outcome: null,
  escalationReference: "SJPU/2027/0142",
};

describe("safeguardingReportAuditSnapshot", () => {
  it("keeps status, severity and assignee, and nothing else", () => {
    expect(safeguardingReportAuditSnapshot(report)).toEqual({
      status: "investigating",
      severity: "high",
      assignedToUserId: LEAD_ID,
    });
  });

  it("leaks none of the report's words or identifiers", () => {
    const json = JSON.stringify(safeguardingReportAuditSnapshot(report));
    for (const secret of [
      report.id,
      report.reference,
      "coach",
      "Asha",
      "example.test",
      "Pune",
      "SJPU",
      "suspected_abuse",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("takes a fresh report with no severity or assignee", () => {
    expect(
      safeguardingReportAuditSnapshot({
        status: "new",
        severity: null,
        assignedToUserId: null,
      })
    ).toEqual({ status: "new", severity: null, assignedToUserId: null });
  });

  it("refuses an assignee that isn't an id", () => {
    expect(() =>
      safeguardingReportAuditSnapshot({
        status: "new",
        severity: null,
        assignedToUserId: "Asha Rao",
      })
    ).toThrow();
  });
});

describe("incidentLogEntryAuditSnapshot", () => {
  it("records an entry by id and kind, never its text", () => {
    // An entry as the database returns it, text and all.
    const entry = {
      id: ENTRY_ID,
      kind: "note" as const,
      body: "Called the school's principal",
    };
    const snapshot = incidentLogEntryAuditSnapshot(entry);
    expect(snapshot).toEqual({ entryId: ENTRY_ID, kind: "note" });
    expect(JSON.stringify(snapshot)).not.toContain("principal");
  });
});

describe("queueViewAuditSnapshot", () => {
  it("records how many reports were shown", () => {
    expect(queueViewAuditSnapshot(3)).toEqual({ shown: 3 });
    expect(() => queueViewAuditSnapshot(-1)).toThrow();
  });
});

describe("SAFEGUARDING_AUDIT_ACTIONS", () => {
  it("names one action per use case, all under safeguarding.", () => {
    expect(new Set(SAFEGUARDING_AUDIT_ACTIONS).size).toBe(
      SAFEGUARDING_AUDIT_ACTIONS.length
    );
    for (const action of SAFEGUARDING_AUDIT_ACTIONS) {
      expect(action).toMatch(/^safeguarding\.[a-z_]+$/);
    }
  });
});
