import { describe, expect, it } from "vitest";

import { normaliseStudentPhone } from "../student-profile";
import { type EnrolmentContext, prepareStudent } from "./prepare-student";
import { readStudentCsv, type StudentCsvFile } from "./student-csv";
import type { StudentInput } from "./student-details";
import { importOutcome, prepareImportRows } from "./student-import";

function readFile(text: string): StudentCsvFile {
  const result = readStudentCsv(new TextEncoder().encode(text));
  if (!result.ok) throw new Error(`unreadable: ${result.problem.code}`);
  return result.file;
}

const CONTEXT: EnrolmentContext = {
  ageCutoffDate: "2027-06-01",
  ageGroups: [
    { id: "g1", label: "6–9", minAge: 6, maxAge: 9 },
    { id: "g2", label: "10–13", minAge: 10, maxAge: 13 },
  ],
  today: { year: 2027, month: 1, day: 15 },
  institutionDefaults: {
    pinCode: "411001",
    city: "Pune",
    state: "Maharashtra",
  },
};

/** #75's rules, with a blind index that shows what it hashed. */
const prepare = (input: StudentInput) =>
  prepareStudent(CONTEXT, input, {
    normalisePhone: normaliseStudentPhone,
    blindIndex: { of: (purpose, value) => `${purpose}#${value}` },
  });

const GUARDIAN = "Kavita Rao,parent,90000 00301";

describe("prepareImportRows", () => {
  it("checks each row with the single-student rules and keys it by roll number, then identity", () => {
    const file = readFile(
      "student_ref,full_name,date_of_birth,guardian_name,guardian_relationship,guardian_phone\r\n" +
        ` 4b  07 ,Aanya  Rao,2017-06-01,${GUARDIAN}\r\n` +
        `,Ishaan Rao,01/06/2017,${GUARDIAN}\r\n`
    );

    const rows = prepareImportRows(file.rows, prepare);

    expect(rows).toMatchObject([
      {
        ok: true,
        rowNumber: 2,
        value: { ageGroup: { label: "10–13" }, studentRefKey: "4B 07" },
        keys: [
          "ref:4B 07",
          "id:participant_profile.identity#student-identity:v1:aanya rao|2017-06-01",
        ],
      },
      {
        ok: true,
        rowNumber: 3,
        keys: [
          "id:participant_profile.identity#student-identity:v1:ishaan rao|2017-06-01",
        ],
      },
    ]);
  });

  it("reports a row the student rules refuse, with #75's problems", () => {
    const file = readFile(
      "full_name,date_of_birth,guardian_name,guardian_relationship,guardian_phone\r\n" +
        ",31/02/2016,,,\r\n" +
        `Vikram Rao,2013-06-01,${GUARDIAN}\r\n`
    );

    expect(prepareImportRows(file.rows, prepare)).toEqual([
      {
        ok: false,
        rowNumber: 2,
        problems: [
          { field: "fullName", code: "required" },
          { field: "dateOfBirth", code: "invalid_date" },
        ],
      },
      {
        ok: false,
        rowNumber: 3,
        problems: [
          {
            field: "dateOfBirth",
            code: "outside_age_groups",
            age: 14,
            groups: CONTEXT.ageGroups,
            ageCutoffDate: "2027-06-01",
          },
        ],
      },
    ]);
  });

  it("refuses a row with cells beyond the last column, even when its known cells pass", () => {
    const file = readFile(
      "full_name,date_of_birth,guardian_name,guardian_relationship,guardian_phone\r\n" +
        `Aanya Rao,2017-06-01,${GUARDIAN},Class 5\r\n` +
        `,2017-06-01,${GUARDIAN},Class 5\r\n`
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

describe("importOutcome", () => {
  const file = readFile(
    "full_name,date_of_birth\r\nA,1\r\nB,2\r\n\r\nC,3\r\nD,4\r\nE,5\r\n"
  );

  it("counts every row and lists each not enrolled, in file order, with its cells and why", () => {
    const outcome = importOutcome(
      file.rows,
      [
        { rowNumber: 7, kind: "already_enrolled" },
        {
          rowNumber: 3,
          kind: "invalid",
          problems: [{ field: "fullName", code: "too_short" }],
        },
        { rowNumber: 5, kind: "duplicate_in_file", duplicateOf: 2 },
      ],
      [
        { rowNumber: 2, kind: "enrolled", result: null },
        // Enrolled by someone else after the plan was made.
        { rowNumber: 6, kind: "already_enrolled" },
      ]
    );

    expect(outcome).toEqual({
      counts: {
        total: 5,
        enrolled: 1,
        notEnrolled: 4,
        invalid: 1,
        duplicateInFile: 1,
        alreadyEnrolled: 2,
      },
      notEnrolled: [
        {
          rowNumber: 3,
          cells: ["B", "2"],
          problems: [{ field: "fullName", code: "too_short" }],
        },
        {
          rowNumber: 5,
          cells: ["C", "3"],
          problems: [{ code: "duplicate_in_file", duplicateOf: 2 }],
        },
        {
          rowNumber: 6,
          cells: ["D", "4"],
          problems: [{ code: "already_enrolled" }],
        },
        {
          rowNumber: 7,
          cells: ["E", "5"],
          problems: [{ code: "already_enrolled" }],
        },
      ],
    });
  });
});
