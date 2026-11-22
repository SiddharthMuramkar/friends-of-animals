import { describe, expect, it } from "vitest";

import {
  REPORT_EVENTS,
  REPORT_TRANSITIONS,
  SAFEGUARDING_REPORT_STATUSES,
  allowedReportEvents,
  decideReportTransition,
  incidentLogKindFor,
  isOpenReport,
  reportActionSchema,
  type ReportEvent,
  type SafeguardingReportStatus,
} from "./report-status";

/** Every allowed move, written out once by hand: from, event, to. */
const ALLOWED: [
  SafeguardingReportStatus,
  ReportEvent,
  SafeguardingReportStatus,
][] = [
  ["new", "triage", "triaged"],
  ["triaged", "start_investigation", "investigating"],
  ["triaged", "resolve", "resolved"],
  ["investigating", "escalate", "escalated"],
  ["investigating", "resolve", "resolved"],
  ["escalated", "resolve", "resolved"],
];

describe("the report transition table", () => {
  it("allows exactly the listed moves and refuses every other pair", () => {
    for (const from of SAFEGUARDING_REPORT_STATUSES) {
      for (const event of REPORT_EVENTS) {
        const allowed = ALLOWED.find(([f, e]) => f === from && e === event);
        const decision = decideReportTransition({ from, event });
        if (allowed) {
          expect(decision, `${from} --${event}-->`).toEqual({
            ok: true,
            to: allowed[2],
          });
        } else {
          expect(decision.ok, `${from} --${event}--> refused`).toBe(false);
        }
      }
    }
  });

  it("keeps the exported table and the decision in step", () => {
    const fromTable = SAFEGUARDING_REPORT_STATUSES.flatMap((from) =>
      Object.entries(REPORT_TRANSITIONS[from]).map(([event, to]) => [
        from,
        event,
        to,
      ])
    );
    expect(fromTable).toEqual(ALLOWED);
  });

  it("refuses a new report going straight to resolved or investigating", () => {
    expect(decideReportTransition({ from: "new", event: "resolve" })).toEqual({
      ok: false,
      reason: "transition_not_allowed",
    });
    expect(
      decideReportTransition({ from: "new", event: "start_investigation" })
    ).toEqual({ ok: false, reason: "transition_not_allowed" });
  });

  it("refuses escalating a report nobody is investigating yet", () => {
    expect(
      decideReportTransition({ from: "triaged", event: "escalate" })
    ).toEqual({ ok: false, reason: "transition_not_allowed" });
  });

  it("refuses triaging a report twice", () => {
    expect(
      decideReportTransition({ from: "investigating", event: "triage" })
    ).toEqual({ ok: false, reason: "transition_not_allowed" });
  });

  it("never moves a resolved report, and says why", () => {
    for (const event of REPORT_EVENTS) {
      expect(decideReportTransition({ from: "resolved", event })).toEqual({
        ok: false,
        reason: "report_resolved",
      });
    }
  });
});

describe("allowedReportEvents", () => {
  it("lists what the lead can do next, in table order", () => {
    expect(allowedReportEvents("new")).toEqual(["triage"]);
    expect(allowedReportEvents("triaged")).toEqual([
      "start_investigation",
      "resolve",
    ]);
    expect(allowedReportEvents("investigating")).toEqual([
      "escalate",
      "resolve",
    ]);
    expect(allowedReportEvents("escalated")).toEqual(["resolve"]);
    expect(allowedReportEvents("resolved")).toEqual([]);
  });
});

describe("isOpenReport", () => {
  it("is true until the report is resolved", () => {
    expect(SAFEGUARDING_REPORT_STATUSES.filter(isOpenReport)).toEqual([
      "new",
      "triaged",
      "investigating",
      "escalated",
    ]);
  });
});

describe("incidentLogKindFor", () => {
  it("logs an escalation as such and every other move as a status change", () => {
    expect(incidentLogKindFor("escalate")).toBe("escalation");
    expect(incidentLogKindFor("triage")).toBe("status_change");
    expect(incidentLogKindFor("start_investigation")).toBe("status_change");
    expect(incidentLogKindFor("resolve")).toBe("status_change");
  });
});

describe("reportActionSchema", () => {
  it("needs a severity to triage", () => {
    expect(
      reportActionSchema.safeParse({ event: "triage", severity: "high" })
        .success
    ).toBe(true);
    expect(reportActionSchema.safeParse({ event: "triage" }).success).toBe(
      false
    );
    expect(
      reportActionSchema.safeParse({ event: "triage", severity: "urgent" })
        .success
    ).toBe(false);
  });

  it("needs the authority's reference to escalate", () => {
    expect(
      reportActionSchema.safeParse({
        event: "escalate",
        authorityReference: "  SJPU/2027/0142 ",
      }).data
    ).toEqual({ event: "escalate", authorityReference: "SJPU/2027/0142" });
    expect(
      reportActionSchema.safeParse({
        event: "escalate",
        authorityReference: " ",
      }).success
    ).toBe(false);
  });

  it("needs an outcome to resolve, and caps its length", () => {
    expect(
      reportActionSchema.safeParse({
        event: "resolve",
        outcome: "No action needed.",
      }).success
    ).toBe(true);
    expect(
      reportActionSchema.safeParse({ event: "resolve", outcome: "" }).success
    ).toBe(false);
    expect(
      reportActionSchema.safeParse({
        event: "resolve",
        outcome: "x".repeat(4001),
      }).success
    ).toBe(false);
  });

  it("takes starting an investigation with nothing else", () => {
    expect(
      reportActionSchema.safeParse({ event: "start_investigation" }).success
    ).toBe(true);
    expect(
      reportActionSchema.safeParse({
        event: "start_investigation",
        outcome: "smuggled",
      }).success
    ).toBe(false);
  });
});
