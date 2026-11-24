import { describe, expect, it } from "vitest";

import {
  buildSubmissionRoster,
  type RosterEntry,
  type RosterStudent,
} from "./roster";

// #87: the coordinator's list of students with each one's entry status
// and what to do next. Pure: the use case loads the students of one
// institution registration, their entries, and whether submission is open.

function student(
  name: string,
  overrides: Partial<RosterStudent> = {}
): RosterStudent {
  return {
    registrationId: `reg-${name}`,
    studentName: name,
    registrationNumber: `PAWS27-R-${name.toUpperCase().padEnd(6, "X").slice(0, 6)}`,
    registrationStatus: "confirmed",
    ...overrides,
  };
}

function entry(
  name: string,
  status: RosterEntry["status"],
  checking = false
): RosterEntry {
  return {
    registrationId: `reg-${name}`,
    code: `PAWS27-E-${name.toUpperCase().padEnd(6, "X").slice(0, 6)}`,
    status,
    checking,
  };
}

describe("buildSubmissionRoster", () => {
  it("offers each confirmed student the next step while submission is open", () => {
    const roster = buildSubmissionRoster({
      students: [
        student("asha"),
        student("bina"),
        student("chetan"),
        student("divya"),
        student("esha"),
        student("farid"),
      ],
      entries: [
        entry("bina", "processing", true),
        entry("chetan", "submitted"),
        entry("divya", "submitted", true),
        entry("esha", "rejected"),
        entry("farid", "failed"),
      ],
      gate: "open",
    });

    expect(
      roster.rows.map(({ studentName, status, action, hold, checking }) => ({
        studentName,
        status,
        action,
        hold,
        checking,
      }))
    ).toEqual([
      {
        studentName: "asha",
        status: "not_started",
        action: "submit",
        hold: null,
        checking: false,
      },
      {
        studentName: "bina",
        status: "processing",
        action: null,
        hold: null,
        checking: true,
      },
      {
        studentName: "chetan",
        status: "submitted",
        action: "replace",
        hold: null,
        checking: false,
      },
      {
        studentName: "divya",
        status: "submitted",
        action: null,
        hold: null,
        checking: true,
      },
      {
        studentName: "esha",
        status: "rejected",
        action: "retry",
        hold: null,
        checking: false,
      },
      {
        studentName: "farid",
        status: "failed",
        action: "retry",
        hold: null,
        checking: false,
      },
    ]);
    expect(roster.rows[2]!.entryCode).toBe("PAWS27-E-CHETAN");
  });

  it("holds every student while submission isn't open, and an unconfirmed one always", () => {
    for (const gate of [
      "shortlist_only",
      "submission_not_open",
      "deadline_passed",
    ] as const) {
      const roster = buildSubmissionRoster({
        students: [
          student("asha"),
          student("bina", {
            registrationStatus: "enrolled",
            registrationNumber: null,
          }),
        ],
        entries: [entry("asha", "submitted")],
        gate,
      });
      expect(roster.rows.map(({ action, hold }) => ({ action, hold }))).toEqual(
        [
          { action: null, hold: gate },
          { action: null, hold: "registration_not_confirmed" },
        ]
      );
    }
    const open = buildSubmissionRoster({
      students: [student("chetan", { registrationStatus: "withdrawn" })],
      entries: [],
      gate: "open",
    });
    expect(open.rows[0]).toMatchObject({
      action: null,
      hold: "registration_not_confirmed",
      status: "not_started",
    });
  });

  it("offers nothing for an entry past the school round's first step", () => {
    const roster = buildSubmissionRoster({
      students: [student("asha")],
      entries: [entry("asha", "school_shortlisted")],
      gate: "open",
    });
    expect(roster.rows[0]).toMatchObject({
      status: "school_shortlisted",
      action: null,
      hold: null,
    });
  });

  it("sorts by name, ignoring case and accents, and counts every status", () => {
    const roster = buildSubmissionRoster({
      students: [student("Zoya"), student("ábhay"), student("Bina")],
      entries: [entry("Zoya", "submitted"), entry("Bina", "submitted")],
      gate: "open",
    });

    expect(roster.rows.map((row) => row.studentName)).toEqual([
      "ábhay",
      "Bina",
      "Zoya",
    ]);
    expect(roster.counts.total).toBe(3);
    expect(roster.counts.byStatus).toMatchObject({
      not_started: 1,
      submitted: 2,
      processing: 0,
      rejected: 0,
    });
    expect(roster.counts.needingUpload).toBe(1);
  });

  it("refuses an entry for someone not on the roster, so a scoping mistake never shows", () => {
    expect(() =>
      buildSubmissionRoster({
        students: [student("asha")],
        entries: [entry("ravi", "submitted")],
        gate: "open",
      })
    ).toThrow(/not on this roster/);
    expect(() =>
      buildSubmissionRoster({
        students: [student("asha")],
        entries: [entry("asha", "submitted"), entry("asha", "rejected")],
        gate: "open",
      })
    ).toThrow(/more than one entry/);
  });
});
