import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  breachFanOut,
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
import { recordedBreach, staffActor, userIdOf } from "./testing";

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
  getTableName(breachFanOut),
];
const entries = DATA_INVENTORY.filter((entry) =>
  BREACH_TABLES.includes(entry.table)
);
const listed = entries.map((entry) => `${entry.table}.${entry.column}`);

describe("the breach log's entries in the data inventory", () => {
  it("list every encrypted column and every column naming a person", () => {
    expect([...listed].sort()).toEqual(
      [
        ...encryptedColumns(breachRecord),
        ...encryptedColumns(breachTimelineEvent),
        "breach_record.lead_user_id",
        "breach_timeline_event.author_user_id",
        "breach_notification.recipient_user_id",
        "breach_notification.guardian_profile_ids",
        "breach_fan_out.after_user_id",
        "breach_unreachable.subject_id",
      ].sort()
    );
    expect(encryptedColumns(breachRecord)).toEqual([
      "breach_record.title_ciphertext",
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
  it.each([
    [
      "2023-03-01T10:00:00.000Z",
      "2028-02-29T10:00:00.000Z",
      "2028-03-01T10:00:00.000Z",
    ],
    [
      "2024-02-29T10:00:00.000Z",
      "2029-02-28T10:00:00.000Z",
      "2029-03-01T10:00:00.000Z",
    ],
  ])(
    "uses the fifth UTC anniversary of a breach closed at %s",
    async (closedAt, earlySweep, anniversary) => {
      const h = await createHarness();
      h.clock.set(closedAt);
      const admin = await staffActor(h, "super_admin");
      const breachId = await recordedBreach(h, admin);
      await expect(
        h.as(admin).containBreach({ breachId })
      ).resolves.toMatchObject({ ok: true });
      await expect(
        h.as(admin).closeBreach({ breachId, reason: "Nothing left FOA." })
      ).resolves.toMatchObject({ ok: true });

      expect(
        await breachRetentionCandidates(h.db, new Date(earlySweep))
      ).toEqual([]);
      expect(
        await breachRetentionCandidates(
          h.db,
          new Date(new Date(anniversary).getTime() - 1)
        )
      ).toEqual([]);
      expect(
        await breachRetentionCandidates(h.db, new Date(anniversary))
      ).toEqual([breachId]);
      expect(await h.as(admin).getBreach({ breachId })).toMatchObject({
        ok: true,
        breach: { status: "closed", closedAt: new Date(closedAt) },
      });
    }
  );

  it("has a migrated index on the lifecycle status and retention cutoff", async () => {
    const h = await createHarness();
    const indexes = await h.db.execute<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'breach_record'
    `);
    expect(indexes.rows.map(({ indexdef }) => indexdef)).toContainEqual(
      expect.stringContaining("USING btree (status, closed_at)")
    );
  });

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

describe("the daily sweep's breachRecords policy", () => {
  it("deletes a breach with its timeline 5 years after it closes, and keeps it while its lead is held", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId });
    await h.as(admin).closeBreach({ breachId, reason: "Nothing left FOA." });
    const [stored] = await h.db
      .select({ lead: breachRecord.leadUserId })
      .from(breachRecord)
      .where(eq(breachRecord.id, breachId));
    const lead = stored?.lead ?? userIdOf(admin);
    const hold = await h.as(admin).placeLegalHold({
      subjectType: "user",
      subjectId: lead,
      reason: "Authority inquiry",
    });
    if (!hold.ok) throw new Error(hold.error);
    h.clock.advance({ days: 5 * 366 });
    const worker = h.as({ kind: "system", process: "worker" });

    const held = await worker.runRetentionSweep();
    expect(held.policies.breachRecords).toMatchObject({ held: 1 });
    expect(await h.db.select().from(breachRecord)).toHaveLength(1);

    // Five years on, releasing needs a fresh sign-in and second factor.
    const releaser = await staffActor(h, "super_admin");
    expect(
      await h.as(releaser).releaseLegalHold({ holdId: hold.holdId })
    ).toEqual({ ok: true });
    const swept = await worker.runRetentionSweep();
    expect(swept.policies.breachRecords).toMatchObject({ deleted: 1 });
    expect(await h.db.select().from(breachRecord)).toEqual([]);
    expect(await h.db.select().from(breachTimelineEvent)).toEqual([]);
  });
});
