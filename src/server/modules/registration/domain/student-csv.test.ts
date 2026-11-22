import { describe, expect, it } from "vitest";

import { formatCsv, parseCsv } from "./csv";
import {
  formatStudentImportReport,
  readStudentCsv,
  STUDENT_CSV_COLUMNS,
  STUDENT_IMPORT_LIMITS,
  studentCsvTemplate,
} from "./student-csv";

const bytes = (text: string) => new TextEncoder().encode(text);

const HEADER = STUDENT_CSV_COLUMNS.map((column) => column.header);

describe("STUDENT_CSV_COLUMNS", () => {
  it("lists every column the template has, in template order", () => {
    expect(HEADER).toEqual([
      "student_ref",
      "full_name",
      "date_of_birth",
      "grade",
      "guardian_name",
      "guardian_relationship",
      "guardian_phone",
      "guardian_email",
      "student_phone",
      "student_email",
      "address",
      "pin_code",
      "city",
      "state",
    ]);
  });

  it("maps each column to one student detail", () => {
    const fields = STUDENT_CSV_COLUMNS.map((column) => column.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe("studentCsvTemplate", () => {
  it("is the header row alone, with a byte order mark for spreadsheets", () => {
    expect(studentCsvTemplate()).toBe(`\uFEFF${HEADER.join(",")}\r\n`);
  });

  it("reads back as a file with the right columns and no rows", () => {
    expect(readStudentCsv(bytes(studentCsvTemplate()))).toEqual({
      ok: false,
      problem: { code: "no_rows" },
    });
  });
});

describe("readStudentCsv", () => {
  it("reads each row's cells into student details, numbered as a spreadsheet numbers them", () => {
    const result = readStudentCsv(
      bytes(
        "full_name,date_of_birth,guardian_phone\r\n" +
          "Aanya Rao,09/03/2016,+91 90000 00001\r\n" +
          "Kabir Singh,2015-11-30,\r\n"
      )
    );
    expect(result).toEqual({
      ok: true,
      file: {
        header: ["full_name", "date_of_birth", "guardian_phone"],
        ignoredColumns: [],
        rows: [
          {
            rowNumber: 2,
            cells: ["Aanya Rao", "09/03/2016", "+91 90000 00001"],
            input: {
              fullName: "Aanya Rao",
              dateOfBirth: "09/03/2016",
              guardianPhone: "+91 90000 00001",
            },
            extraCells: false,
          },
          {
            rowNumber: 3,
            cells: ["Kabir Singh", "2015-11-30", ""],
            input: {
              fullName: "Kabir Singh",
              dateOfBirth: "2015-11-30",
              guardianPhone: "",
            },
            extraCells: false,
          },
        ],
      },
    });
  });

  it("matches headers whatever their case, spacing or hyphens", () => {
    const result = readStudentCsv(
      bytes(
        " Full Name ,DATE-OF-BIRTH,Student  Phone\nAsha Iyer,2001-01-01,x\n"
      )
    );
    expect(result.ok && result.file.rows[0]?.input).toEqual({
      fullName: "Asha Iyer",
      dateOfBirth: "2001-01-01",
      phone: "x",
    });
  });

  it("tolerates a byte order mark", () => {
    const result = readStudentCsv(
      bytes("\uFEFFfull_name,date_of_birth\nAsha Iyer,2001-01-01\n")
    );
    expect(result.ok && result.file.header).toEqual([
      "full_name",
      "date_of_birth",
    ]);
  });

  it("skips blank rows but keeps counting them", () => {
    const result = readStudentCsv(
      bytes("full_name,date_of_birth\n,\n  ,\t\nAsha Iyer,2001-01-01\n\n")
    );
    expect(result.ok && result.file.rows.map((row) => row.rowNumber)).toEqual([
      4,
    ]);
  });

  it("gives short rows empty cells for the missing columns", () => {
    const result = readStudentCsv(
      bytes("full_name,date_of_birth,grade\nAsha Iyer\n")
    );
    expect(result.ok && result.file.rows[0]).toMatchObject({
      cells: ["Asha Iyer", "", ""],
      input: { fullName: "Asha Iyer", dateOfBirth: "", grade: "" },
      extraCells: false,
    });
  });

  it("flags a row with filled cells beyond the last column", () => {
    const result = readStudentCsv(
      bytes(
        "full_name,date_of_birth\nAsha Iyer,2001-01-01,oops\nRavi,2001-01-01,,\n"
      )
    );
    expect(
      result.ok &&
        result.file.rows.map((row) => [row.rowNumber, row.extraCells])
    ).toEqual([
      [2, true],
      [3, false],
    ]);
  });

  it("ignores unknown columns and lists them", () => {
    const result = readStudentCsv(
      bytes("full_name,section,date_of_birth\nAsha Iyer,B,2001-01-01\n")
    );
    expect(result.ok && result.file.ignoredColumns).toEqual(["section"]);
    expect(result.ok && result.file.rows[0]?.input).toEqual({
      fullName: "Asha Iyer",
      dateOfBirth: "2001-01-01",
    });
  });

  it("ignores the error report's own columns without listing them", () => {
    const result = readStudentCsv(
      bytes(
        "full_name,date_of_birth,row_number,problems\n" +
          "Asha Iyer,2001-01-01,7,date_of_birth: not a real date\n"
      )
    );
    expect(result.ok && result.file.ignoredColumns).toEqual([]);
    expect(result.ok && result.file.rows[0]?.input).toEqual({
      fullName: "Asha Iyer",
      dateOfBirth: "2001-01-01",
    });
  });

  it("takes off the quote the error report put in front of a phone", () => {
    const report = formatStudentImportReport(
      ["full_name", "date_of_birth", "guardian_phone"],
      [
        {
          rowNumber: 2,
          cells: ["Aanya Rao", "2016-03-09", "+91 90000 00001"],
          problems: ["guardian_relationship: required"],
        },
      ]
    );
    const result = readStudentCsv(bytes(report));
    expect(result.ok && result.file.rows[0]?.input).toEqual({
      fullName: "Aanya Rao",
      dateOfBirth: "2016-03-09",
      guardianPhone: "+91 90000 00001",
    });
  });

  it("refuses an empty file", () => {
    expect(readStudentCsv(new Uint8Array())).toEqual({
      ok: false,
      problem: { code: "empty" },
    });
    expect(readStudentCsv(bytes("\uFEFF \r\n"))).toEqual({
      ok: false,
      problem: { code: "empty" },
    });
  });

  it("refuses a file over the size limit before reading it", () => {
    const big = new Uint8Array(STUDENT_IMPORT_LIMITS.maxBytes + 1).fill(0xff);
    expect(readStudentCsv(big)).toEqual({
      ok: false,
      problem: { code: "too_large", maxBytes: STUDENT_IMPORT_LIMITS.maxBytes },
    });
  });

  it("refuses a file that isn't UTF-8, as Excel's plain CSV on Windows can be", () => {
    // "Zoë" in Windows-1252: 0xEB on its own is not UTF-8.
    const latin1 = new Uint8Array([
      ...bytes("full_name,date_of_birth\nZo"),
      0xeb,
      ...bytes(",2001-01-01\n"),
    ]);
    expect(readStudentCsv(latin1)).toEqual({
      ok: false,
      problem: { code: "not_utf8" },
    });
  });

  it.each([
    [";", "full_name;date_of_birth\nAsha;2001-01-01\n"],
    ["\t", "full_name\tdate_of_birth\nAsha\t2001-01-01\n"],
  ])("refuses a file separated by %j instead of commas", (separator, text) => {
    expect(readStudentCsv(bytes(text))).toEqual({
      ok: false,
      problem: { code: "wrong_separator", separator },
    });
  });

  it("refuses a broken file, naming the line", () => {
    expect(
      readStudentCsv(bytes('full_name,date_of_birth\n"Asha,2001-01-01\n'))
    ).toEqual({
      ok: false,
      problem: { code: "malformed", reason: "unterminated_quote", line: 2 },
    });
  });

  it("refuses a file missing the name or date of birth column", () => {
    expect(readStudentCsv(bytes("name,dob\nAsha,2001-01-01\n"))).toEqual({
      ok: false,
      problem: {
        code: "missing_columns",
        columns: ["full_name", "date_of_birth"],
      },
    });
  });

  it("refuses a file that has a column twice", () => {
    expect(
      readStudentCsv(
        bytes("full_name,date_of_birth,Full Name\nA,2001-01-01,B\n")
      )
    ).toEqual({
      ok: false,
      problem: { code: "duplicate_columns", columns: ["full_name"] },
    });
  });

  it("accepts the row limit and refuses one row more", () => {
    const file = (rows: number) =>
      bytes(
        "full_name,date_of_birth\n" + "Asha Iyer,2001-01-01\n".repeat(rows)
      );
    const limits = { ...STUDENT_IMPORT_LIMITS, maxRows: 3 };
    expect(readStudentCsv(file(3), limits).ok).toBe(true);
    expect(readStudentCsv(file(4), limits)).toEqual({
      ok: false,
      problem: { code: "too_many_rows", maxRows: 3, rows: 4 },
    });
  });

  it("fits a full 1,000-row file in the size limit", () => {
    const row =
      "ROLL-0001,Aanya Lakshmi Raghunathan,09/03/2016,Class 5,Lakshmi Raghunathan,parent,+91 90000 00001," +
      'lakshmi.raghunathan@example.test,,,"Flat 12, Green Meadows Apartments, 4th Cross Road",560001,Bengaluru,Karnataka\n';
    const file = bytes(
      HEADER.join(",") + "\n" + row.repeat(STUDENT_IMPORT_LIMITS.maxRows)
    );
    expect(file.length).toBeLessThanOrEqual(STUDENT_IMPORT_LIMITS.maxBytes);
    expect(readStudentCsv(file).ok).toBe(true);
  });

  it("accepts the column limit and refuses one column more", () => {
    const limits = { ...STUDENT_IMPORT_LIMITS, maxColumns: 4 };
    const file = (extra: string) =>
      bytes(`full_name,date_of_birth,${extra}\nAsha Iyer,2001-01-01\n`);
    expect(readStudentCsv(file("a,b"), limits).ok).toBe(true);
    expect(readStudentCsv(file("a,b,c"), limits)).toEqual({
      ok: false,
      problem: { code: "too_many_columns", maxColumns: 4, columns: 5 },
    });
  });

  it("leaves the error report's own columns out of the column limit, so a report of a full file reads back", () => {
    const limits = { ...STUDENT_IMPORT_LIMITS, maxColumns: 3 };
    const report = formatStudentImportReport(
      ["full_name", "date_of_birth", "section"],
      [{ rowNumber: 2, cells: ["Asha Iyer", "2001-01-01", "B"], problems: [] }]
    );
    expect(readStudentCsv(bytes(report), limits).ok).toBe(true);
  });

  it("refuses the error report's own columns twice", () => {
    expect(
      readStudentCsv(
        bytes(
          "full_name,date_of_birth,problems,Problems\nAsha Iyer,2001-01-01,,\n"
        )
      )
    ).toEqual({
      ok: false,
      problem: { code: "duplicate_columns", columns: ["problems"] },
    });
  });

  it("leaves out blank header cells after the last named column, as spreadsheets write them", () => {
    const result = readStudentCsv(
      bytes(
        "full_name,date_of_birth,,,\n" +
          "Asha Iyer,2001-01-01,,,\n" +
          "Ravi Kumar,2001-01-01,,oops,\n"
      )
    );
    expect(result).toEqual({
      ok: true,
      file: {
        header: ["full_name", "date_of_birth"],
        ignoredColumns: [],
        rows: [
          expect.objectContaining({
            rowNumber: 2,
            cells: ["Asha Iyer", "2001-01-01"],
            extraCells: false,
          }),
          // A cell under no column name is a shifted row, as beyond the header.
          expect.objectContaining({
            rowNumber: 3,
            cells: ["Ravi Kumar", "2001-01-01"],
            extraCells: true,
          }),
        ],
      },
    });
  });

  it("doesn't list a column with a blank name as left out", () => {
    const result = readStudentCsv(
      bytes("full_name, ,date_of_birth\nAsha Iyer,B,2001-01-01\n")
    );
    expect(result.ok && result.file.ignoredColumns).toEqual([]);
    expect(result.ok && result.file.rows[0]?.input).toEqual({
      fullName: "Asha Iyer",
      dateOfBirth: "2001-01-01",
    });
  });

  it("finds the header row below blank rows, and keeps counting them", () => {
    const result = readStudentCsv(
      bytes("\r\n,,\r\nfull_name,date_of_birth\r\nAsha Iyer,2001-01-01\r\n")
    );
    expect(result.ok && result.file.header).toEqual([
      "full_name",
      "date_of_birth",
    ]);
    expect(result.ok && result.file.rows.map((row) => row.rowNumber)).toEqual([
      4,
    ]);
  });

  // A file under the size limit can still name a huge number of columns or
  // rows: refused before a single row is read into cells, or it runs the
  // server out of memory.
  it("refuses 150,000 columns in a file under the size limit", () => {
    const file = bytes(
      "full_name,date_of_birth" +
        ",x".repeat(150_000) +
        "\n" +
        "N,1\n".repeat(30_000)
    );
    expect(file.length).toBeLessThanOrEqual(STUDENT_IMPORT_LIMITS.maxBytes);
    expect(readStudentCsv(file)).toEqual({
      ok: false,
      problem: {
        code: "too_many_columns",
        maxColumns: STUDENT_IMPORT_LIMITS.maxColumns,
        columns: 150_002,
      },
    });
  });

  it("refuses 30,000 rows under a header padded with 150,000 blank cells", () => {
    const file = bytes(
      "full_name,date_of_birth" +
        ",".repeat(150_000) +
        "\n" +
        "x,1\n".repeat(30_000)
    );
    expect(file.length).toBeLessThanOrEqual(STUDENT_IMPORT_LIMITS.maxBytes);
    expect(readStudentCsv(file)).toEqual({
      ok: false,
      problem: {
        code: "too_many_rows",
        maxRows: STUDENT_IMPORT_LIMITS.maxRows,
        rows: 30_000,
      },
    });
  });

  it("refuses too many rows of a file at the column limit", () => {
    const header = [
      "full_name",
      "date_of_birth",
      ...Array.from(
        { length: STUDENT_IMPORT_LIMITS.maxColumns - 2 },
        (_, n) => `c${n}`
      ),
    ].join(",");
    const file = bytes(header + "\n" + "x\n".repeat(300_000));
    expect(file.length).toBeLessThanOrEqual(STUDENT_IMPORT_LIMITS.maxBytes);
    expect(readStudentCsv(file)).toEqual({
      ok: false,
      problem: {
        code: "too_many_rows",
        maxRows: STUDENT_IMPORT_LIMITS.maxRows,
        rows: 300_000,
      },
    });
  });
});

describe("formatStudentImportReport", () => {
  it("hands back the rows as uploaded, with their row number and problems", () => {
    const report = formatStudentImportReport(
      ["full_name", "date_of_birth", "section"],
      [
        {
          rowNumber: 9,
          cells: ["Ravi Kumar", "31/02/2016", "B"],
          problems: ["date_of_birth: not a real date"],
        },
        {
          rowNumber: 4,
          cells: ["Asha Iyer", "2016-01-01", "A"],
          problems: [
            "guardian_name: required for a student under 18",
            "guardian_phone: required for a student under 18",
          ],
        },
      ]
    );
    expect(report.startsWith("\uFEFF")).toBe(true);
    expect(parseCsv(report)).toEqual({
      ok: true,
      records: [
        ["full_name", "date_of_birth", "section", "row_number", "problems"],
        [
          "Asha Iyer",
          "2016-01-01",
          "A",
          "4",
          "guardian_name: required for a student under 18; guardian_phone: required for a student under 18",
        ],
        [
          "Ravi Kumar",
          "31/02/2016",
          "B",
          "9",
          "date_of_birth: not a real date",
        ],
      ],
    });
  });

  it("neutralises every cell that a spreadsheet would run as a formula", () => {
    const report = formatStudentImportReport(
      ["full_name", "date_of_birth"],
      [
        {
          rowNumber: 2,
          cells: ['=HYPERLINK("http://example.test","x")', "@SUM(1)"],
          problems: ["-bad"],
        },
      ]
    );
    expect(parseCsv(report)).toEqual({
      ok: true,
      records: [
        ["full_name", "date_of_birth", "row_number", "problems"],
        ['\'=HYPERLINK("http://example.test","x")', "'@SUM(1)", "2", "'-bad"],
      ],
    });
  });

  it("replaces the columns of an earlier report rather than repeating them", () => {
    const report = formatStudentImportReport(
      ["full_name", "row_number", "date_of_birth", "Problems"],
      [{ rowNumber: 3, cells: ["Asha", "7", "x", "old"], problems: ["new"] }]
    );
    expect(parseCsv(report)).toEqual({
      ok: true,
      records: [
        ["full_name", "date_of_birth", "row_number", "problems"],
        ["Asha", "x", "3", "new"],
      ],
    });
  });

  it("pads short rows and drops cells beyond the last column", () => {
    const report = formatStudentImportReport(
      ["full_name", "date_of_birth"],
      [
        { rowNumber: 2, cells: ["Asha"], problems: ["p"] },
        {
          rowNumber: 3,
          cells: ["Ravi", "2001-01-01", "extra"],
          problems: ["q"],
        },
      ]
    );
    expect(report).toBe(
      "\uFEFF" +
        formatCsv([
          ["full_name", "date_of_birth", "row_number", "problems"],
          ["Asha", "", "2", "p"],
          ["Ravi", "2001-01-01", "3", "q"],
        ])
    );
  });
});
