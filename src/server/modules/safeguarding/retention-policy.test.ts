import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  safeguardingIncidentLog,
  safeguardingReport,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { DATA_INVENTORY } from "@/server/modules/privacy/inventory";
import { SUBJECT_AGE_FLOOR, YEARS_AFTER_RESOLUTION } from "./domain/retention";
import {
  SAFEGUARDING_RETENTION_POLICY,
  safeguardingRetentionCandidates,
} from "./retention-policy";
import { CONCERN, fileReport } from "./testing";

/** Every column built with #58's encryptedText(), by its SQL name. */
function encryptedColumns(
  table: typeof safeguardingReport | typeof safeguardingIncidentLog
) {
  return Object.values(getTableColumns(table))
    .filter((column) => column.columnType === "PgCustomColumn")
    .map((column) => `${getTableName(table)}.${column.name}`);
}

const entries = DATA_INVENTORY.filter((entry) =>
  entry.table.startsWith("safeguarding_")
);
const listed = entries.map((entry) => `${entry.table}.${entry.column}`);

describe("safeguarding's entries in the data inventory", () => {
  it("list every encrypted column, the child's age and who handled the case", () => {
    expect([...listed].sort()).toEqual(
      [
        ...encryptedColumns(safeguardingReport),
        ...encryptedColumns(safeguardingIncidentLog),
        "safeguarding_report.subject_age",
        "safeguarding_report.assigned_to_user_id",
        "safeguarding_incident_log.author_user_id",
      ].sort()
    );
    expect(encryptedColumns(safeguardingReport)).toHaveLength(6);
    expect(encryptedColumns(safeguardingIncidentLog)).toHaveLength(1);
  });

  it("give each a purpose and the safeguarding retention, still to confirm", () => {
    for (const entry of entries) {
      expect(entry.purpose.length, entry.column).toBeGreaterThan(10);
      expect(entry.retention.toConfirm).toBe(true);
      expect(entry.retention.period, entry.column).toContain(
        `${YEARS_AFTER_RESOLUTION} years after it is resolved`
      );
      expect(entry.retention.period, entry.column).toContain(
        `turns ${SUBJECT_AGE_FLOOR}`
      );
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
