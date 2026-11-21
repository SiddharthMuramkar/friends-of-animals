import { describe, expect, it } from "vitest";

import { keyDateProblems, orderedKeyDates, type KeyDates } from "./key-dates";

const at = (iso: string) => new Date(iso);

const complete: KeyDates = {
  registration_opens: at("2027-01-01T03:30:00Z"),
  registration_closes: at("2027-01-31T18:29:00Z"),
  submissions_close: at("2027-02-15T18:29:00Z"),
  school_round_closes: at("2027-02-28T18:29:00Z"),
};

describe("keyDateProblems()", () => {
  it("finds nothing wrong with complete, ordered dates", () => {
    expect(keyDateProblems(complete, "both")).toEqual([]);
  });

  it("needs the registration window and the submission deadline", () => {
    expect(keyDateProblems({}, "individuals")).toEqual([
      { field: "registration_opens", code: "required" },
      { field: "registration_closes", code: "required" },
      { field: "submissions_close", code: "required" },
    ]);
  });

  it("needs a school round deadline when institutions take part", () => {
    const { school_round_closes: _, ...rest } = complete;
    for (const participation of ["institutions", "both"] as const) {
      expect(keyDateProblems(rest, participation)).toEqual([
        { field: "school_round_closes", code: "required" },
      ]);
    }
  });

  it("refuses a school round deadline when only individuals take part", () => {
    expect(keyDateProblems(complete, "individuals")).toEqual([
      { field: "school_round_closes", code: "not_applicable" },
    ]);
  });

  it("needs registration to close after it opens", () => {
    const dates = {
      ...complete,
      registration_closes: complete.registration_opens,
    };
    expect(keyDateProblems(dates, "both")).toEqual([
      {
        field: "registration_closes",
        code: "must_follow",
        other: "registration_opens",
      },
    ]);
  });

  it("lets submissions close at the same instant registration closes", () => {
    const dates = {
      ...complete,
      submissions_close: complete.registration_closes,
    };
    expect(keyDateProblems(dates, "both")).toEqual([]);
  });

  it("refuses submissions closing before registration closes", () => {
    const dates = {
      ...complete,
      submissions_close: at("2027-01-20T18:29:00Z"),
    };
    expect(keyDateProblems(dates, "both")).toEqual([
      {
        field: "submissions_close",
        code: "must_follow",
        other: "registration_closes",
      },
    ]);
  });

  it("needs the school round to close after submissions close", () => {
    const dates = {
      ...complete,
      school_round_closes: complete.submissions_close,
    };
    expect(keyDateProblems(dates, "institutions")).toEqual([
      {
        field: "school_round_closes",
        code: "must_follow",
        other: "submissions_close",
      },
    ]);
  });

  it("checks order only between dates that are present", () => {
    const { registration_closes: _, ...rest } = complete;
    expect(keyDateProblems(rest, "both")).toEqual([
      { field: "registration_closes", code: "required" },
    ]);
  });
});

describe("orderedKeyDates()", () => {
  it("lists the dates that are set, in timeline order", () => {
    expect(
      orderedKeyDates({
        submissions_close: complete.submissions_close!,
        registration_opens: complete.registration_opens!,
      })
    ).toEqual([
      { kind: "registration_opens", at: complete.registration_opens },
      { kind: "submissions_close", at: complete.submissions_close },
    ]);
  });
});
