import { describe, expect, it } from "vitest";

import {
  planErasure,
  type ErasureEntry,
  type SubjectRows,
} from "./erasure-plan";

const now = new Date("2027-06-01T04:30:00.000Z");
const later = new Date("2035-04-01T00:00:00.000Z");
const lapsed = new Date("2027-04-01T00:00:00.000Z");

function entry(
  table: string,
  column: string,
  onExpiry: ErasureEntry["onExpiry"],
  basis: ErasureEntry["retention"]["basis"] = "consent",
  category: ErasureEntry["category"] = "identity"
): ErasureEntry {
  return { table, column, category, retention: { basis }, onExpiry };
}

// A member's world, as the inventory describes it.
const ENTRIES: ErasureEntry[] = [
  entry("participant_profile", "first_name", "tombstone"),
  entry("participant_profile", "city", "set_null", "consent", "demographic"),
  entry(
    "message_delivery",
    "address",
    "delete_row",
    "legitimate_use",
    "contact"
  ),
  entry("donation", "donor_name", "tombstone", "legal_obligation", "financial"),
  entry("donation", "donor_message", "set_null", "consent", "content"),
  entry("consent_event", "giver_ip", "retain", "legal_obligation", "technical"),
];

function rows(table: string, ...items: SubjectRows["rows"]): SubjectRows {
  return { table, rows: items };
}

describe("planErasure", () => {
  it("deletes, anonymises and keeps each table as its inventory says", () => {
    const plan = planErasure({
      now,
      onLegalHold: false,
      entries: ENTRIES,
      subjectRows: [
        rows("participant_profile", { id: "p1", floorLapsesAt: null }),
        rows(
          "message_delivery",
          { id: "m1", floorLapsesAt: null },
          { id: "m2", floorLapsesAt: null }
        ),
        rows(
          "donation",
          { id: "d-old", floorLapsesAt: lapsed },
          { id: "d-new", floorLapsesAt: later }
        ),
        rows("consent_event", { id: "c1", floorLapsesAt: null }),
      ],
    });

    expect(plan.tables).toEqual([
      {
        table: "consent_event",
        deleteRowIds: [],
        anonymise: [],
        retained: [
          {
            table: "consent_event",
            category: "technical",
            reason: "append_only",
            basis: "legal_obligation",
            rows: 1,
            until: null,
          },
        ],
      },
      {
        table: "donation",
        // The lapsed donation's floor is over, so it goes like any row
        // whose columns all anonymise; the recent one keeps its financial
        // columns until its floor and loses only the consented message.
        deleteRowIds: [],
        anonymise: [
          {
            rowIds: ["d-old"],
            patch: { donor_message: null, donor_name: "[removed]" },
          },
          { rowIds: ["d-new"], patch: { donor_message: null } },
        ],
        retained: [
          {
            table: "donation",
            category: "financial",
            reason: "floor",
            basis: "legal_obligation",
            rows: 1,
            until: later,
          },
        ],
      },
      {
        table: "message_delivery",
        deleteRowIds: ["m1", "m2"],
        anonymise: [],
        retained: [],
      },
      {
        table: "participant_profile",
        deleteRowIds: [],
        anonymise: [
          {
            rowIds: ["p1"],
            patch: { city: null, first_name: "[removed]" },
          },
        ],
        retained: [],
      },
    ]);
    expect(plan.outcome).toBe("partially_completed");
    expect(plan.retained.map((r) => `${r.table}.${r.category}`)).toEqual([
      "consent_event.technical",
      "donation.financial",
    ]);
  });

  it("completes in full when nothing has to stay", () => {
    const plan = planErasure({
      now,
      onLegalHold: false,
      entries: ENTRIES,
      subjectRows: [
        rows("participant_profile", { id: "p1", floorLapsesAt: null }),
        rows("message_delivery", { id: "m1", floorLapsesAt: null }),
      ],
    });
    expect(plan.outcome).toBe("completed");
    expect(plan.retained).toEqual([]);
  });

  it("keeps every row of a subject on legal hold, and changes nothing", () => {
    const plan = planErasure({
      now,
      onLegalHold: true,
      entries: ENTRIES,
      subjectRows: [
        rows("participant_profile", { id: "p1", floorLapsesAt: null }),
        rows("message_delivery", { id: "m1", floorLapsesAt: null }),
      ],
    });
    expect(plan.tables.flatMap((t) => t.deleteRowIds)).toEqual([]);
    expect(plan.tables.flatMap((t) => t.anonymise)).toEqual([]);
    expect(plan.retained).toEqual([
      {
        table: "message_delivery",
        category: "contact",
        reason: "legal_hold",
        basis: "legitimate_use",
        rows: 1,
        until: null,
      },
      {
        table: "participant_profile",
        category: "demographic",
        reason: "legal_hold",
        basis: "consent",
        rows: 1,
        until: null,
      },
      {
        table: "participant_profile",
        category: "identity",
        reason: "legal_hold",
        basis: "consent",
        rows: 1,
        until: null,
      },
    ]);
    expect(plan.outcome).toBe("partially_completed");
  });

  it("has nothing to do for a subject with no rows: done in full", () => {
    const plan = planErasure({
      now,
      onLegalHold: false,
      entries: ENTRIES,
      subjectRows: [],
    });
    expect(plan.tables).toEqual([]);
    expect(plan.outcome).toBe("completed");
  });

  it("refuses rows of a table the inventory doesn't know", () => {
    expect(() =>
      planErasure({
        now,
        onLegalHold: false,
        entries: ENTRIES,
        subjectRows: [rows("mystery", { id: "x1", floorLapsesAt: null })],
      })
    ).toThrow(/mystery/);
  });

  it("reports the latest floor among the rows a category keeps", () => {
    const sooner = new Date("2031-04-01T00:00:00.000Z");
    const plan = planErasure({
      now,
      onLegalHold: false,
      entries: ENTRIES,
      subjectRows: [
        rows(
          "donation",
          { id: "d1", floorLapsesAt: sooner },
          { id: "d2", floorLapsesAt: later }
        ),
      ],
    });
    expect(plan.retained).toEqual([
      expect.objectContaining({ category: "financial", rows: 2, until: later }),
    ]);
  });
});

describe("planErasure: the fingerprint the officer approves", () => {
  const base = {
    now,
    onLegalHold: false,
    entries: ENTRIES,
  };

  it("stays the same when only ids or row counts change", () => {
    const one = planErasure({
      ...base,
      subjectRows: [
        rows("message_delivery", { id: "m1", floorLapsesAt: null }),
      ],
    });
    const three = planErasure({
      ...base,
      subjectRows: [
        rows(
          "message_delivery",
          { id: "m7", floorLapsesAt: null },
          { id: "m8", floorLapsesAt: null },
          { id: "m9", floorLapsesAt: null }
        ),
      ],
    });
    expect(three.fingerprint).toBe(one.fingerprint);
  });

  it("changes when what happens to a table changes", () => {
    const subjectRows = [
      rows("participant_profile", { id: "p1", floorLapsesAt: null }),
    ];
    const before = planErasure({ ...base, subjectRows });
    const held = planErasure({ ...base, onLegalHold: true, subjectRows });
    const newColumn = planErasure({
      ...base,
      entries: [...ENTRIES, entry("participant_profile", "school", "set_null")],
      subjectRows,
    });
    expect(held.fingerprint).not.toBe(before.fingerprint);
    expect(newColumn.fingerprint).not.toBe(before.fingerprint);
  });

  it("names no row ids", () => {
    const plan = planErasure({
      ...base,
      subjectRows: [
        rows("message_delivery", { id: "m-secret", floorLapsesAt: null }),
      ],
    });
    expect(plan.fingerprint).not.toContain("m-secret");
  });
});
