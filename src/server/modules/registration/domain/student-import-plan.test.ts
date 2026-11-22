import { describe, expect, it } from "vitest";

import {
  enrolPlannedRows,
  planStudentImport,
  type PreparedImportRow,
  summariseStudentImport,
} from "./student-import-plan";

const valid = (rowNumber: number, ...keys: string[]) =>
  ({
    ok: true,
    rowNumber,
    value: `student ${rowNumber}`,
    keys,
  }) satisfies PreparedImportRow<string, string>;

const invalid = (rowNumber: number, ...problems: string[]) =>
  ({ ok: false, rowNumber, problems }) satisfies PreparedImportRow<
    string,
    string
  >;

describe("planStudentImport", () => {
  it("enrols every valid row of a clean file, in file order", () => {
    const plan = planStudentImport(
      [valid(2, "id:a"), valid(3, "id:b"), valid(4, "id:c")],
      new Set()
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
    expect(plan.skipped).toEqual([]);
  });

  it("reports invalid rows with their problems and enrols the rest", () => {
    const plan = planStudentImport(
      [valid(2, "id:a"), invalid(3, "dob", "phone"), valid(4, "id:c")],
      new Set()
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(plan.skipped).toEqual([
      { rowNumber: 3, kind: "invalid", problems: ["dob", "phone"] },
    ]);
  });

  it("enrols the first of two rows for one student and reports the second against it", () => {
    const plan = planStudentImport(
      [valid(2, "id:a"), valid(3, "id:b"), valid(5, "id:a")],
      new Set()
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(plan.skipped).toEqual([
      { rowNumber: 5, kind: "duplicate_in_file", duplicateOf: 2 },
    ]);
  });

  it("matches on any shared key: a roll number or the identity", () => {
    const plan = planStudentImport(
      [
        valid(2, "ref:R1", "id:a"),
        valid(3, "id:b"),
        valid(4, "ref:R1", "id:z"),
        valid(6, "ref:R9", "id:b"),
      ],
      new Set()
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(plan.skipped).toEqual([
      { rowNumber: 4, kind: "duplicate_in_file", duplicateOf: 2 },
      { rowNumber: 6, kind: "duplicate_in_file", duplicateOf: 3 },
    ]);
  });

  it("points every later copy at the first row, not at the copy before it", () => {
    const plan = planStudentImport(
      [valid(2, "id:a"), valid(3, "id:a"), valid(4, "id:a")],
      new Set()
    );
    expect(plan.skipped).toEqual([
      { rowNumber: 3, kind: "duplicate_in_file", duplicateOf: 2 },
      { rowNumber: 4, kind: "duplicate_in_file", duplicateOf: 2 },
    ]);
  });

  it("ignores invalid rows when looking for copies, so a fixed copy later in the file still enrols", () => {
    const plan = planStudentImport(
      [invalid(2, "phone"), valid(3, "id:a")],
      new Set()
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([3]);
  });

  it("skips students already enrolled, whichever key matched", () => {
    const plan = planStudentImport(
      [valid(2, "ref:R1", "id:a"), valid(3, "id:b"), valid(4, "id:c")],
      new Set(["id:a", "id:c"])
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([3]);
    expect(plan.skipped).toEqual([
      { rowNumber: 2, kind: "already_enrolled" },
      { rowNumber: 4, kind: "already_enrolled" },
    ]);
  });

  it("says already enrolled, not duplicate, when an enrolled student is in the file twice", () => {
    const plan = planStudentImport(
      [valid(2, "id:a"), valid(3, "id:a")],
      new Set(["id:a"])
    );
    expect(plan.skipped).toEqual([
      { rowNumber: 2, kind: "already_enrolled" },
      { rowNumber: 3, kind: "already_enrolled" },
    ]);
  });

  it("enrols only the fixed rows when a report comes back after an import", () => {
    // First upload: rows 2 and 4 enrolled, row 3 invalid.
    const enrolled = new Set(["id:a", "id:c"]);
    // The whole file again, row 3 fixed.
    const plan = planStudentImport(
      [valid(2, "id:a"), valid(3, "id:b"), valid(4, "id:c")],
      enrolled
    );
    expect(plan.toEnrol.map((row) => row.rowNumber)).toEqual([3]);
  });

  it("keeps the valid row's value and keys for the insert", () => {
    expect(planStudentImport([valid(2, "id:a")], new Set()).toEnrol).toEqual([
      { rowNumber: 2, value: "student 2", keys: ["id:a"] },
    ]);
  });
});

describe("summariseStudentImport", () => {
  it("counts every row once, by what became of it", () => {
    expect(
      summariseStudentImport([
        { rowNumber: 2, kind: "enrolled" },
        { rowNumber: 3, kind: "invalid" },
        { rowNumber: 4, kind: "duplicate_in_file" },
        { rowNumber: 5, kind: "already_enrolled" },
        { rowNumber: 6, kind: "enrolled" },
        { rowNumber: 7, kind: "invalid" },
      ])
    ).toEqual({
      total: 6,
      enrolled: 2,
      notEnrolled: 4,
      invalid: 2,
      duplicateInFile: 1,
      alreadyEnrolled: 1,
    });
  });

  it("counts a clean 30-row file as 30 enrolled", () => {
    const outcomes = Array.from({ length: 30 }, (_, index) => ({
      rowNumber: index + 2,
      kind: "enrolled" as const,
    }));
    expect(summariseStudentImport(outcomes)).toEqual({
      total: 30,
      enrolled: 30,
      notEnrolled: 0,
      invalid: 0,
      duplicateInFile: 0,
      alreadyEnrolled: 0,
    });
  });
});

describe("enrolPlannedRows", () => {
  const conflict = new Error("duplicate key value violates unique constraint");
  const isConflict = (error: unknown) => error === conflict;

  it("enrols the rows one at a time, in file order", async () => {
    const calls: string[] = [];
    let running = 0;
    const outcomes = await enrolPlannedRows(
      [
        { rowNumber: 2, value: "a" },
        { rowNumber: 3, value: "b" },
      ],
      async (value) => {
        running += 1;
        expect(running).toBe(1);
        calls.push(value);
        await Promise.resolve();
        running -= 1;
        return `reg-${value}`;
      },
      isConflict
    );
    expect(calls).toEqual(["a", "b"]);
    expect(outcomes).toEqual([
      { rowNumber: 2, kind: "enrolled", result: "reg-a" },
      { rowNumber: 3, kind: "enrolled", result: "reg-b" },
    ]);
  });

  it("reports a row that lost a race to the unique index as already enrolled, and carries on", async () => {
    const outcomes = await enrolPlannedRows(
      [
        { rowNumber: 2, value: "a" },
        { rowNumber: 3, value: "b" },
        { rowNumber: 4, value: "c" },
      ],
      async (value) => {
        if (value === "b") throw conflict;
        return value;
      },
      isConflict
    );
    expect(outcomes).toEqual([
      { rowNumber: 2, kind: "enrolled", result: "a" },
      { rowNumber: 3, kind: "already_enrolled" },
      { rowNumber: 4, kind: "enrolled", result: "c" },
    ]);
  });

  it("stops at any other failure and passes it on, so the whole import rolls back", async () => {
    const broken = new Error("connection lost");
    const calls: string[] = [];
    await expect(
      enrolPlannedRows(
        [
          { rowNumber: 2, value: "a" },
          { rowNumber: 3, value: "b" },
          { rowNumber: 4, value: "c" },
        ],
        async (value) => {
          calls.push(value);
          if (value === "b") throw broken;
          return value;
        },
        isConflict
      )
    ).rejects.toBe(broken);
    expect(calls).toEqual(["a", "b"]);
  });
});
