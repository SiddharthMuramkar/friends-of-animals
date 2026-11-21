import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  safeguardingIncidentLog,
  safeguardingReport,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  SAFEGUARDING_INVENTORY,
  SAFEGUARDING_RETENTION_POLICY,
  safeguardingRetentionCandidates,
} from "./inventory";
import { CONCERN, fileReport } from "./testing";

/** Every column built with #58's encryptedText(), by its SQL name. */
function encryptedColumns(
  table: typeof safeguardingReport | typeof safeguardingIncidentLog
) {
  return Object.values(getTableColumns(table))
    .filter((column) => column.columnType === "PgCustomColumn")
    .map((column) => `${getTableName(table)}.${column.name}`);
}

const listed = SAFEGUARDING_INVENTORY.map(
  (entry) => `${entry.table}.${entry.column}`
);

describe("the safeguarding data inventory", () => {
  it("lists every encrypted column and the child's age", () => {
    expect([...listed].sort()).toEqual(
      [
        ...encryptedColumns(safeguardingReport),
        ...encryptedColumns(safeguardingIncidentLog),
        "safeguarding_report.subject_age",
      ].sort()
    );
    expect(listed).toEqual(
      expect.arrayContaining([
        "safeguarding_report.reporter_name",
        "safeguarding_report.reporter_contact",
        "safeguarding_report.description",
        "safeguarding_report.subject_details",
        "safeguarding_report.outcome",
        "safeguarding_report.escalation_reference",
        "safeguarding_incident_log.body",
      ])
    );
  });

  it("gives each a purpose and the safeguarding retention, still to confirm", () => {
    for (const entry of SAFEGUARDING_INVENTORY) {
      expect(entry.purpose.length, entry.column).toBeGreaterThan(10);
      expect(entry.retention).toMatchObject({
        policy: "safeguardingReports",
        toConfirm: true,
      });
      expect(entry.retention.period).toMatch(/7 years/);
    }
    expect(SAFEGUARDING_RETENTION_POLICY.key).toBe("safeguardingReports");
  });
});

describe("which safeguarding reports retention may delete", () => {
  it("picks resolved reports past both dates, never an open one", async () => {
    const h = await createHarness({ now: "2026-01-10T04:00:00Z" });
    // Resolved the day they were filed: stored directly, since this is
    // about which rows retention picks, not how they got resolved.
    const resolved = (subjectAge: number) =>
      fileReport(
        h,
        { ...CONCERN, subjectAge },
        {
          status: "resolved",
          severity: "low",
          outcome: "Done",
          resolvedAt: h.clock.now(),
        }
      );
    // A 17-year-old turns 25 within 8 years, so 7 years after resolution
    // is not enough; a 10-year-old needs 15 years.
    const older = await resolved(17);
    const younger = await resolved(10);
    const open = await fileReport(h);

    const at = (iso: string) =>
      safeguardingRetentionCandidates(h.db, new Date(iso));

    expect(await at("2033-01-09T00:00:00Z")).toEqual([]);
    expect(await at("2034-01-11T00:00:00Z")).toEqual([older]);
    expect(await at("2041-01-11T00:00:00Z")).toEqual([older, younger].sort());
    expect(await at("2100-01-01T00:00:00Z")).not.toContain(open);
  });
});
