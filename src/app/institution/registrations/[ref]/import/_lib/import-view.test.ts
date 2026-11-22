import { describe, expect, it } from "vitest";

import messages from "../../../../../../../messages/en-IN/studentImport.json";
import { STUDENT_CSV_COLUMNS } from "@/server/modules/registration/domain/student-csv";
import type {
  ImportStudentsResult,
  StudentCsvProblem,
} from "@/server/modules/registration";

import {
  type ImportAttempt,
  importView,
  type ImportWords,
} from "./import-view";

/** Shows which message and values were chosen, instead of the words. */
const words: ImportWords = {
  t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
  formatDate: (isoDate) => `date(${isoDate})`,
};

const HEADER = [
  "Full Name",
  "date_of_birth",
  "guardian_name",
  "guardian_relationship",
  "guardian_phone",
  "notes",
];

const counts = (overrides: Partial<Record<string, number>>) => ({
  total: 0,
  enrolled: 0,
  notEnrolled: 0,
  invalid: 0,
  duplicateInFile: 0,
  alreadyEnrolled: 0,
  ...overrides,
});

describe("importView", () => {
  it("says a clean import enrolled everyone, with nothing to fix", () => {
    const result: ImportStudentsResult = {
      ok: true,
      counts: counts({ total: 30, enrolled: 30 }),
      header: HEADER.slice(0, 5),
      ignoredColumns: [],
      notEnrolled: [],
    };

    expect(importView(result, words)).toEqual({
      step: "done",
      tone: "success",
      summary: 'summary.all {"enrolled":30}',
      rows: [],
    });
  });

  it("words each row's problems by its column, names the student, and builds the report of rows to fix", () => {
    const result: ImportStudentsResult = {
      ok: true,
      counts: counts({
        total: 6,
        enrolled: 1,
        notEnrolled: 5,
        invalid: 3,
        duplicateInFile: 1,
        alreadyEnrolled: 1,
      }),
      header: HEADER,
      ignoredColumns: ["notes"],
      notEnrolled: [
        {
          rowNumber: 3,
          cells: ["", "31/02/2016", "Meena Shah", "uncle", "=1+1", "x"],
          problems: [
            { field: "fullName", code: "required" },
            { field: "dateOfBirth", code: "invalid_date" },
            { field: "guardianRelationship", code: "invalid_choice" },
          ],
        },
        {
          rowNumber: 4,
          cells: ["Vikram Rao", "2013-06-01", "Kavita Rao", "parent", "", ""],
          problems: [
            { field: "guardianEmail", code: "required" },
            {
              field: "dateOfBirth",
              code: "outside_age_groups",
              age: 14,
              groups: [
                { id: "g2", label: "10–13", minAge: 10, maxAge: 13 },
                { id: "g1", label: "6–9", minAge: 6, maxAge: 9 },
              ],
              ageCutoffDate: "2027-06-01",
            },
          ],
        },
        {
          rowNumber: 5,
          cells: ["Ishaan Rao", "2019-02-02", "", "", "", ""],
          problems: [{ code: "extra_cells" }, { code: "no_age_groups" }],
        },
        {
          rowNumber: 6,
          cells: ["aanyá rao", "2017-06-01", "", "", "", ""],
          problems: [{ code: "duplicate_in_file", duplicateOf: 2 }],
        },
        {
          rowNumber: 7,
          cells: ["Diya Nair", "2018-08-22", "", "", "", ""],
          problems: [{ code: "already_enrolled" }],
        },
      ],
    };

    const view = importView(result, words);

    expect(view).toEqual({
      step: "done",
      tone: "danger",
      summary: 'summary.some {"enrolled":1,"notEnrolled":5}',
      ignored: 'ignored {"columns":"notes"}',
      rows: [
        {
          rowNumber: 3,
          name: "noName",
          problems: [
            "problems.required.fullName",
            'problems.invalid_date {"column":"date_of_birth"}',
            'problems.invalid_choice {"column":"guardian_relationship"}',
          ],
        },
        {
          rowNumber: 4,
          name: "Vikram Rao",
          problems: [
            'problems.missing {"column":"guardian_email"}',
            'problems.outside_age_groups {"minAge":6,"maxAge":13,"age":14,"cutoff":"date(2027-06-01)"}',
          ],
        },
        {
          rowNumber: 5,
          name: "Ishaan Rao",
          problems: ["problems.extra_cells", "problems.age_groups_need_fixing"],
        },
        {
          rowNumber: 6,
          name: "aanyá rao",
          problems: ['problems.duplicate_in_file {"row":2}'],
        },
        {
          rowNumber: 7,
          name: "Diya Nair",
          problems: ["problems.already_enrolled"],
        },
      ],
      report: expect.any(String),
    });
    const report = view.step === "done" ? (view.report ?? "") : "";
    const lines = report.slice(1).split("\r\n");
    expect(report.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe(`${HEADER.join(",")},row_number,problems`);
    // A spreadsheet must not run what someone typed.
    expect(lines[1]).toBe(
      `,31/02/2016,Meena Shah,uncle,'=1+1,x,3,"problems.required.fullName; problems.invalid_date {""column"":""date_of_birth""}; problems.invalid_choice {""column"":""guardian_relationship""}"`
    );
    expect(lines).toHaveLength(7);
  });

  it("says nobody was enrolled when no row could be", () => {
    const result: ImportStudentsResult = {
      ok: true,
      counts: counts({ total: 1, notEnrolled: 1, alreadyEnrolled: 1 }),
      header: HEADER.slice(0, 2),
      ignoredColumns: [],
      notEnrolled: [
        {
          rowNumber: 2,
          cells: ["Diya Nair", "2018-08-22"],
          problems: [{ code: "already_enrolled" }],
        },
      ],
    };

    expect(importView(result, words)).toMatchObject({
      step: "done",
      tone: "danger",
      summary: 'summary.none {"notEnrolled":1}',
    });
  });

  it.each<[StudentCsvProblem, string]>([
    [{ code: "empty" }, "file.empty"],
    [{ code: "too_large", maxBytes: 768_000 }, 'file.too_large {"maxKb":750}'],
    [{ code: "not_utf8" }, "file.not_utf8"],
    [
      { code: "wrong_separator", separator: "\t" },
      'file.wrong_separator {"separator":"tab"}',
    ],
    [
      { code: "wrong_separator", separator: ";" },
      'file.wrong_separator {"separator":"semicolon"}',
    ],
    [
      { code: "malformed", reason: "unterminated_quote", line: 4 },
      'file.malformed {"line":4}',
    ],
    [
      { code: "missing_columns", columns: ["full_name", "date_of_birth"] },
      'file.missing_columns {"columns":"full_name, date_of_birth"}',
    ],
    [
      { code: "duplicate_columns", columns: ["grade"] },
      'file.duplicate_columns {"columns":"grade"}',
    ],
    [
      { code: "too_many_columns", maxColumns: 40, columns: 150_002 },
      'file.too_many_columns {"columns":150002,"maxColumns":40}',
    ],
    [{ code: "no_rows" }, "file.no_rows"],
    [
      { code: "too_many_rows", maxRows: 1000, rows: 1200 },
      'file.too_many_rows {"rows":1200,"maxRows":1000}',
    ],
  ])("explains a file it can't read: %j", (problem, alert) => {
    expect(
      importView({ ok: false, error: "unreadable_file", problem }, words)
    ).toEqual({ step: "refused", alert });
  });

  it.each<[ImportAttempt, string]>([
    ["forbidden", "alert.forbidden"],
    [undefined, "alert.failed"],
    [
      { ok: false, error: "invalid_input", fields: ["file"] },
      "alert.not_found",
    ],
    [{ ok: false, error: "not_found" }, "alert.not_found"],
    [{ ok: false, error: "closed" }, "alert.closed"],
    [{ ok: false, error: "not_open_yet" }, "alert.not_open_yet"],
    [
      { ok: false, error: "institution_not_verified" },
      "alert.institution_not_verified",
    ],
  ])("explains a refusal: %j", (result, alert) => {
    expect(importView(result, words)).toEqual({ step: "refused", alert });
  });
});

describe("the column guide", () => {
  it("describes every column of the template, and nothing else", () => {
    expect(Object.keys(messages.studentImport.columns.describe)).toEqual(
      STUDENT_CSV_COLUMNS.map((column) => column.header)
    );
  });
});
