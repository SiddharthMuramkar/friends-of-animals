import { describe, expect, it } from "vitest";

import {
  planRetention,
  retentionRunAuditSchema,
  retentionRunSummary,
  type RetentionCandidate,
} from "./retention-plan";

const NOW = new Date("2027-06-01T00:00:00.000Z");
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
const YESTERDAY = new Date("2027-05-31T00:00:00.000Z");

function candidate(
  id: string,
  anchor: Date,
  subjects: RetentionCandidate["subjects"] = []
): RetentionCandidate {
  return { id, anchor, subjects };
}

describe("planRetention", () => {
  it("applies the policy to expired rows and leaves fresh ones", () => {
    const plan = planRetention({
      now: NOW,
      policy: { key: "capturedMessages", action: "delete", days: 30 },
      candidates: [candidate("a", LONG_AGO), candidate("b", YESTERDAY)],
      holds: [],
    });
    expect(plan.apply).toEqual(["a"]);
    expect(plan.counts).toEqual({
      deleted: 1,
      anonymised: 0,
      held: 0,
      retainedByFloor: 0,
    });
  });

  it("counts anonymised rows under their own name", () => {
    const plan = planRetention({
      now: NOW,
      policy: { key: "guardianRequests", action: "anonymise", days: 30 },
      candidates: [candidate("a", LONG_AGO)],
      holds: [],
    });
    expect(plan.counts).toMatchObject({ deleted: 0, anonymised: 1 });
  });

  it("skips a row while any of its subjects is on an active legal hold", () => {
    const plan = planRetention({
      now: NOW,
      policy: { key: "messageDeliveries", action: "delete", days: 30 },
      candidates: [
        candidate("held", LONG_AGO, [
          { type: "user", id: "u-1" },
          { type: "participant_profile", id: "p-1" },
        ]),
        candidate("free", LONG_AGO, [{ type: "user", id: "u-2" }]),
      ],
      holds: [{ subjectType: "participant_profile", subjectId: "p-1" }],
    });
    expect(plan.apply).toEqual(["free"]);
    expect(plan.counts).toMatchObject({ deleted: 1, held: 1 });
  });

  it("matches a hold on both the subject's type and id", () => {
    const plan = planRetention({
      now: NOW,
      policy: { key: "messageDeliveries", action: "delete", days: 30 },
      candidates: [candidate("a", LONG_AGO, [{ type: "user", id: "x" }])],
      holds: [{ subjectType: "institution", subjectId: "x" }],
    });
    expect(plan.apply).toEqual(["a"]);
  });

  it("keeps a financial record its floor protects, whatever the setting", () => {
    const plan = planRetention({
      now: NOW,
      policy: {
        key: "financialRecords",
        action: "anonymise",
        days: 30,
        floor: { kind: "financial_years", years: 8 },
      },
      candidates: [candidate("payment", LONG_AGO)],
      holds: [],
    });
    expect(plan.apply).toEqual([]);
    expect(plan.counts).toEqual({
      deleted: 0,
      anonymised: 0,
      held: 0,
      retainedByFloor: 1,
    });
  });

  it("reports a row that is both held and under its floor as held", () => {
    const plan = planRetention({
      now: NOW,
      policy: {
        key: "financialRecords",
        action: "anonymise",
        days: 30,
        floor: { kind: "financial_years", years: 8 },
      },
      candidates: [candidate("p", LONG_AGO, [{ type: "user", id: "u-1" }])],
      holds: [{ subjectType: "user", subjectId: "u-1" }],
    });
    expect(plan.counts).toMatchObject({ held: 1, retainedByFloor: 0 });
  });

  it("ignores a stored period shorter than the floor allows", () => {
    // A raw value of 1 day written past the settings screen still waits
    // for the 90-day floor.
    const plan = planRetention({
      now: NOW,
      policy: {
        key: "quarantinedFiles",
        action: "delete",
        days: 1,
        floor: { kind: "days", days: 90 },
      },
      candidates: [candidate("recent", new Date("2027-04-01T00:00:00.000Z"))],
      holds: [],
    });
    expect(plan.apply).toEqual([]);
    expect(plan.counts.retainedByFloor).toBe(1);
  });

  it("neither applies nor counts a row whose period isn't over", () => {
    const plan = planRetention({
      now: NOW,
      policy: { key: "capturedMessages", action: "delete", days: 30 },
      candidates: [candidate("fresh", YESTERDAY, [{ type: "user", id: "u" }])],
      holds: [{ subjectType: "user", subjectId: "u" }],
    });
    expect(plan).toEqual({
      apply: [],
      counts: { deleted: 0, anonymised: 0, held: 0, retainedByFloor: 0 },
    });
  });
});

describe("retentionRunSummary", () => {
  it("holds counts per policy key and nothing that names a person", () => {
    const summary = retentionRunSummary({
      dryRun: false,
      policies: {
        capturedMessages: {
          deleted: 3,
          anonymised: 0,
          held: 1,
          retainedByFloor: 0,
        },
      },
    });
    expect(summary).toEqual({
      dryRun: false,
      policies: {
        capturedMessages: {
          deleted: 3,
          anonymised: 0,
          held: 1,
          retainedByFloor: 0,
        },
      },
    });
    expect(retentionRunAuditSchema.parse(summary)).toEqual(summary);
  });

  it("refuses a summary that carries anything but counts", () => {
    const withIds = {
      dryRun: true,
      policies: {
        capturedMessages: {
          deleted: 1,
          anonymised: 0,
          held: 0,
          retainedByFloor: 0,
          ids: ["0193..."],
        },
      },
    };
    expect(retentionRunAuditSchema.safeParse(withIds).success).toBe(false);
    expect(
      retentionRunAuditSchema.safeParse({
        dryRun: true,
        policies: {},
        email: "asha@example.test",
      }).success
    ).toBe(false);
  });

  it("refuses a policy key that could smuggle in personal data", () => {
    const result = retentionRunAuditSchema.safeParse({
      dryRun: false,
      policies: {
        "asha@example.test": {
          deleted: 1,
          anonymised: 0,
          held: 0,
          retainedByFloor: 0,
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
