import { describe, expect, it } from "vitest";

import { readStudentCsv, type StudentCsvFile } from "./student-csv";
import type { StudentInput } from "./student-details";
import {
  prepareImportRows,
  type PrepareStudentResult,
} from "./student-import";

function readFile(text: string): StudentCsvFile {
  const result = readStudentCsv(new TextEncoder().encode(text));
  if (!result.ok) throw new Error(`unreadable: ${result.problem.code}`);
  return result.file;
}

type Student = { identityHash: string; studentRef: string | null };

/**
 * Stands in for #75's prepareStudent, which checks a student whole: here a
 * student is valid once named, and their identity is their name.
 */
function prepare(input: StudentInput): PrepareStudentResult<Student> {
  if (!input.fullName) {
    return { ok: false, problems: [{ field: "fullName", code: "required" }] };
  }
  return {
    ok: true,
    student: {
      identityHash: `hash(${input.fullName})`,
      studentRef: input.studentRef || null,
    },
  };
}

describe("prepareImportRows", () => {
  it("keys each valid row by its roll number, when it has one, then its identity", () => {
    const file = readFile(
      "student_ref,full_name,date_of_birth\r\n" +
        "R1,Aanya Rao,2016-03-09\r\n" +
        ",Kabir Shah,2015-01-02\r\n"
    );
    expect(prepareImportRows(file.rows, prepare)).toEqual([
      {
        ok: true,
        rowNumber: 2,
        value: { identityHash: "hash(Aanya Rao)", studentRef: "R1" },
        keys: ["ref:R1", "id:hash(Aanya Rao)"],
      },
      {
        ok: true,
        rowNumber: 3,
        value: { identityHash: "hash(Kabir Shah)", studentRef: null },
        keys: ["id:hash(Kabir Shah)"],
      },
    ]);
  });

  it("reports a row the student rules refuse, with their problems", () => {
    const file = readFile("full_name,date_of_birth\r\n,2016-03-09\r\n");
    expect(prepareImportRows(file.rows, prepare)).toEqual([
      {
        ok: false,
        rowNumber: 2,
        problems: [{ field: "fullName", code: "required" }],
      },
    ]);
  });

  it("refuses a row with cells beyond the last column, even when its known cells pass", () => {
    const file = readFile(
      "full_name,date_of_birth\r\n" +
        "Aanya Rao,2016-03-09,Class 5\r\n" +
        ",2016-03-09,Class 5\r\n"
    );
    expect(prepareImportRows(file.rows, prepare)).toEqual([
      { ok: false, rowNumber: 2, problems: [{ code: "extra_cells" }] },
      {
        ok: false,
        rowNumber: 3,
        problems: [
          { code: "extra_cells" },
          { field: "fullName", code: "required" },
        ],
      },
    ]);
  });
});
