import { describe, expect, it } from "vitest";

import {
  buildSubmissionRoster,
  type RosterEntry,
  type RosterStudent,
} from "./roster";

const SCHOOL = "01938a00-0000-7000-8000-00000000a001";
const OTHER_SCHOOL = "01938a00-0000-7000-8000-00000000b001";

function student(
  registrationId: string,
  name: string,
  overrides: Partial<RosterStudent["registration"]> = {}
): RosterStudent {
  return {
    registrationId,
    studentName: name,
    registration: {
      route: "institution",
      institutionId: SCHOOL,
      confirmed: true,
      ...overrides,
    },
  };
}

function entry(
  registrationId: string,
  status: RosterEntry["status"],
  replacementPending = false
): RosterEntry {
  return {
    registrationId,
    code: `PAWS26-E-${registrationId.toUpperCase().padStart(6, "0")}`,
    status,
    replacementPending,
  };
}

const scope = { institutionIds: [SCHOOL] };

describe("buildSubmissionRoster", () => {
  it("lists every enrolled student, with or without an entry", () => {
    const roster = buildSubmissionRoster({
      students: [student("r1", "Asha Rao"), student("r2", "Ravi Kumar")],
      entries: [entry("r1", "submitted")],
      scope,
      windowOpen: true,
    });

    expect(roster.rows).toEqual([
      {
        registrationId: "r1",
        studentName: "Asha Rao",
        entryCode: "PAWS26-E-0000R1",
        status: "submitted",
        replacementPending: false,
        action: "replace",
        refusal: null,
      },
      {
        registrationId: "r2",
        studentName: "Ravi Kumar",
        entryCode: null,
        status: "not_started",
        replacementPending: false,
        action: "submit",
        refusal: null,
      },
    ]);
  });

  it("orders students by name, ignoring case and accents", () => {
    const roster = buildSubmissionRoster({
      students: [
        student("r1", "meera Iyer"),
        student("r2", "Ánanya Gupta"),
        student("r3", "Kabir Singh"),
      ],
      entries: [],
      scope,
      windowOpen: true,
    });

    expect(roster.rows.map((row) => row.studentName)).toEqual([
      "Ánanya Gupta",
      "Kabir Singh",
      "meera Iyer",
    ]);
  });

  it("keeps students with the same name in registration order", () => {
    const roster = buildSubmissionRoster({
      students: [student("r2", "Rohan Das"), student("r1", "Rohan Das")],
      entries: [],
      scope,
      windowOpen: true,
    });

    expect(roster.rows.map((row) => row.registrationId)).toEqual(["r1", "r2"]);
  });
});

describe("the action a coordinator can take for a student", () => {
  const cases: Array<{
    when: string;
    entry: RosterEntry | null;
    action: "submit" | "replace" | "retry" | null;
  }> = [
    { when: "no entry yet", entry: null, action: "submit" },
    {
      when: "the first file is still being checked",
      entry: entry("r1", "processing"),
      action: null,
    },
    {
      when: "the entry was received",
      entry: entry("r1", "submitted"),
      action: "replace",
    },
    {
      when: "a replacement is still being checked",
      entry: entry("r1", "submitted", true),
      action: null,
    },
    {
      when: "the file failed the malware scan",
      entry: entry("r1", "rejected"),
      action: "retry",
    },
    {
      when: "the file could not be processed",
      entry: entry("r1", "failed"),
      action: "retry",
    },
    {
      when: "the school round shortlisted it",
      entry: entry("r1", "school_shortlisted"),
      action: null,
    },
    {
      when: "the school round did not shortlist it",
      entry: entry("r1", "not_shortlisted"),
      action: null,
    },
    {
      when: "it went to FOA",
      entry: entry("r1", "submitted_to_foa"),
      action: null,
    },
    {
      when: "FOA verified it",
      entry: entry("r1", "foa_verified"),
      action: null,
    },
    {
      when: "FOA sent it back",
      entry: entry("r1", "sent_back"),
      action: null,
    },
  ];

  for (const { when, entry: given, action } of cases) {
    it(`is ${action ?? "nothing"} while the window is open and ${when}`, () => {
      const roster = buildSubmissionRoster({
        students: [student("r1", "Asha Rao")],
        entries: given ? [given] : [],
        scope,
        windowOpen: true,
      });

      expect(roster.rows[0]?.action).toBe(action);
    });
  }

  it("is nothing for anyone once the submission window has closed", () => {
    const roster = buildSubmissionRoster({
      students: [
        student("r1", "Asha Rao"),
        student("r2", "Ravi Kumar"),
        student("r3", "Meera Iyer"),
      ],
      entries: [entry("r2", "submitted"), entry("r3", "rejected")],
      scope,
      windowOpen: false,
    });

    expect(roster.rows.map((row) => row.action)).toEqual([null, null, null]);
  });

  it("is nothing for an unconfirmed enrolment, and says why", () => {
    const roster = buildSubmissionRoster({
      students: [student("r1", "Asha Rao", { confirmed: false })],
      entries: [],
      scope,
      windowOpen: true,
    });

    expect(roster.rows[0]).toMatchObject({
      status: "not_started",
      action: null,
      refusal: "not_confirmed",
    });
  });
});

describe("roster counts", () => {
  it("counts students by status, unconfirmed ones included", () => {
    const roster = buildSubmissionRoster({
      students: [
        student("r1", "Asha Rao"),
        student("r2", "Ravi Kumar"),
        student("r3", "Meera Iyer"),
        student("r4", "Priya Sharma"),
        student("r5", "Arjun Menon", { confirmed: false }),
      ],
      entries: [
        entry("r1", "submitted"),
        entry("r2", "submitted", true),
        entry("r3", "rejected"),
      ],
      scope,
      windowOpen: true,
    });

    expect(roster.counts).toEqual({
      total: 5,
      byStatus: { not_started: 2, submitted: 2, rejected: 1 },
    });
  });
});

describe("roster safety", () => {
  it("refuses to build a roster that holds another institution's student", () => {
    expect(() =>
      buildSubmissionRoster({
        students: [
          student("r1", "Asha Rao"),
          student("r2", "Fatima Shaikh", { institutionId: OTHER_SCHOOL }),
        ],
        entries: [],
        scope,
        windowOpen: true,
      })
    ).toThrow(/outside the coordinator's institutions/);
  });

  it("refuses to build a roster that holds an individual registration", () => {
    expect(() =>
      buildSubmissionRoster({
        students: [
          student("r1", "Asha Rao", {
            route: "individual",
            institutionId: null,
          }),
        ],
        entries: [],
        scope,
        windowOpen: true,
      })
    ).toThrow(/outside the coordinator's institutions/);
  });

  it("refuses an entry for a student who is not on the roster", () => {
    expect(() =>
      buildSubmissionRoster({
        students: [student("r1", "Asha Rao")],
        entries: [entry("r9", "submitted")],
        scope,
        windowOpen: true,
      })
    ).toThrow(/not on this roster/);
  });

  it("refuses a student listed twice", () => {
    expect(() =>
      buildSubmissionRoster({
        students: [student("r1", "Asha Rao"), student("r1", "Asha Rao")],
        entries: [],
        scope,
        windowOpen: true,
      })
    ).toThrow(/listed more than once/);
  });

  it("refuses two entries for one registration", () => {
    expect(() =>
      buildSubmissionRoster({
        students: [student("r1", "Asha Rao")],
        entries: [entry("r1", "submitted"), entry("r1", "processing")],
        scope,
        windowOpen: true,
      })
    ).toThrow(/more than one entry/);
  });
});
