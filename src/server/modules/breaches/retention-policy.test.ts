import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  breachNotification,
  breachRecord,
  breachTimelineEvent,
  breachUnreachable,
} from "@/server/db/schema";
import { DATA_INVENTORY } from "@/server/modules/privacy/inventory";
import { createHarness } from "@/test/harness";

import {
  BREACH_RETENTION_POLICY,
  breachRetentionCandidates,
  YEARS_AFTER_CLOSE,
} from "./retention-policy";
import { recordedBreach, staffActor } from "./testing";

/** Every column built with #58's encryptedText(), by its SQL name. */
function encryptedColumns(
  table: typeof breachRecord | typeof breachTimelineEvent
) {
  return Object.values(getTableColumns(table))
    .filter((column) => column.columnType === "PgCustomColumn")
    .map((column) => `${getTableName(table)}.${column.name}`);
}

const BREACH_TABLES: readonly string[] = [
  getTableName(breachRecord),
  getTableName(breachTimelineEvent),
  getTableName(breachNotification),
  getTableName(breachUnreachable),
];
const entries = DATA_INVENTORY.filter((entry) =>
  BREACH_TABLES.includes(entry.table)
);
const listed = entries.map((entry) => `${entry.table}.${entry.column}`);

describe("the breach log's entries in the data inventory", () => {
  it("list every encrypted column, the title, and every column naming a person", () => {
    expect([...listed].sort()).toEqual(
      [
        ...encryptedColumns(breachRecord),
        ...encryptedColumns(breachTimelineEvent),
        "breach_record.title",
        "breach_record.lead_user_id",
        "breach_timeline_event.author_user_id",
        "breach_notification.recipient_user_id",
        "breach_unreachable.subject_id",
      ].sort()
    );
    expect(encryptedColumns(breachRecord)).toEqual([
      "breach_record.impact_ciphertext",
      "breach_record.authority_reference_ciphertext",
    ]);
    expect(encryptedColumns(breachTimelineEvent)).toEqual([
      "breach_timeline_event.note_ciphertext",
    ]);
  });

  it("keep each 5 years after the breach is closed, as a legal obligation, still to confirm", () => {
    expect(YEARS_AFTER_CLOSE).toBe(5);
    for (const entry of entries) {
      expect(entry.purpose.length, entry.column).toBeGreaterThan(10);
      expect(entry.retention.toConfirm).toBe(true);
      expect(entry.retention.period, entry.column).toContain(
        "5 years after the breach is closed"
      );
      expect(entry.retention.basis, entry.column).toContain("Legal obligation");
    }
  });
});

describe("breachRetentionCandidates", () => {
  it("picks a closed breach once 5 years have passed since it closed, never an open one", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const closed = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId: closed });
    await h
      .as(admin)
      .closeBreach({ breachId: closed, reason: "Nothing left FOA." });
    const closedAt = h.clock.now();
    await recordedBreach(h, admin);

    const fiveYearsOn = new Date(closedAt);
    fiveYearsOn.setUTCFullYear(fiveYearsOn.getUTCFullYear() + 5);

    expect(
      await breachRetentionCandidates(
        h.db,
        new Date(fiveYearsOn.getTime() - 1000)
      )
    ).toEqual([]);
    expect(await breachRetentionCandidates(h.db, fiveYearsOn)).toEqual([
      closed,
    ]);
    expect(BREACH_RETENTION_POLICY).toMatchObject({
      key: "breachRecords",
      action: "delete",
    });
  });
});
