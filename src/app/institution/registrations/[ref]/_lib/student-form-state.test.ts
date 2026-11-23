import { describe, expect, it } from "vitest";

import type {
  EnrolStudentResult,
  WithdrawStudentResult,
} from "@/server/modules/registration";

import {
  ageRange,
  enrolFormState,
  fieldMessageKey,
  withdrawOutcome,
} from "./student-form-state";

const TYPED = { fullName: "Aanya Rao", dateOfBirth: "2013-06-01" };
const GROUPS = [
  { id: "g-6", label: "6–9", minAge: 6, maxAge: 9 },
  { id: "g-10", label: "10–13", minAge: 10, maxAge: 13 },
];

describe("enrolFormState", () => {
  it("goes back to the list after enrolling, saying whether details were dropped", () => {
    expect(
      enrolFormState(TYPED, {
        ok: true,
        registrationId: "r-1",
        ageGroup: { id: "g-10", label: "10–13" },
        ignored: [],
      })
    ).toEqual({ enrolled: { registrationId: "r-1", ignored: false } });
    expect(
      enrolFormState(TYPED, {
        ok: true,
        registrationId: "r-1",
        ageGroup: { id: "g-10", label: "10–13" },
        ignored: ["phone"],
      })
    ).toEqual({ enrolled: { registrationId: "r-1", ignored: true } });
  });

  it("keeps what was typed and points at each field at fault", () => {
    expect(
      enrolFormState(TYPED, {
        ok: false,
        error: "invalid_student",
        problems: [
          { field: "fullName", code: "too_short" },
          { field: "guardianPhone", code: "required" },
        ],
      })
    ).toEqual({
      values: TYPED,
      alert: "check_details",
      fields: {
        fullName: "too_short",
        guardianPhone: "required.guardianPhone",
      },
    });
  });

  it("explains an age outside every group with the competition's ages and cut-off", () => {
    expect(
      enrolFormState(TYPED, {
        ok: false,
        error: "invalid_student",
        problems: [
          {
            field: "dateOfBirth",
            code: "outside_age_groups",
            age: 14,
            groups: GROUPS,
            ageCutoffDate: "2027-06-01",
          },
        ],
      })
    ).toEqual({
      values: TYPED,
      alert: "check_details",
      fields: { dateOfBirth: "outside_age_groups" },
      outsideAge: {
        age: 14,
        minAge: 6,
        maxAge: 13,
        ageCutoffDate: "2027-06-01",
      },
    });
  });

  const REFUSALS: [EnrolStudentResult | "forbidden" | undefined, string][] = [
    ["forbidden", "forbidden"],
    [{ ok: false, error: "already_enrolled" }, "already_enrolled"],
    [{ ok: false, error: "closed" }, "closed"],
    [{ ok: false, error: "not_found" }, "not_found"],
    [
      { ok: false, error: "invalid_input", fields: ["institutionId"] },
      "not_found",
    ],
    [
      {
        ok: false,
        error: "invalid_student",
        problems: [{ code: "overlapping_age_groups" }],
      },
      "age_groups_need_fixing",
    ],
    [undefined, "failed"],
  ];

  it.each(REFUSALS)(
    "says %j as %s, keeping what was typed",
    (result, alert) => {
      expect(enrolFormState(TYPED, result)).toEqual({
        values: TYPED,
        alert,
        fields: {},
      });
    }
  );
});

describe("fieldMessageKey", () => {
  it("names a missing field by the field, and other problems by what is wrong", () => {
    expect(fieldMessageKey("guardianName", "required")).toBe(
      "required.guardianName"
    );
    expect(fieldMessageKey("pinCode", "invalid_format")).toBe("invalid_format");
    expect(fieldMessageKey("city", "required")).toBe("missing");
  });
});

describe("ageRange", () => {
  it("spans the youngest group's minimum to the oldest group's maximum", () => {
    expect(ageRange(GROUPS)).toEqual({ minAge: 6, maxAge: 13 });
    expect(ageRange([])).toBeNull();
  });
});

describe("withdrawOutcome", () => {
  const RESULTS: [WithdrawStudentResult | "forbidden" | undefined, string][] = [
    ["forbidden", "forbidden"],
    [{ ok: true }, "withdrawn"],
    [{ ok: false, error: "not_enrolled" }, "not_enrolled"],
    [{ ok: false, error: "closed" }, "closed"],
    [
      { ok: false, error: "invalid_input", fields: ["registrationId"] },
      "not_found",
    ],
    [undefined, "failed"],
  ];

  it.each(RESULTS)("says %j as %s", (result, outcome) => {
    expect(withdrawOutcome(result)).toBe(outcome);
  });
});
