import { describe, expect, it } from "vitest";

import {
  actingInstitutions,
  chooseInstitution,
  isRegisterOutcome,
  registerOutcome,
} from "./register-state";

const X = "01938a00-0000-7000-8000-000000001001";
const Y = "01938a00-0000-7000-8000-000000001002";

describe("registerOutcome", () => {
  it("says registered once the institution has its reference", () => {
    expect(
      registerOutcome({
        ok: true,
        registrationId: "01938a00-0000-7000-8000-000000005001",
        reference: "PAWS27-I-Q2W9R",
      })
    ).toBe("registered");
  });

  it.each([
    "not_found",
    "institutions_not_accepted",
    "institution_not_verified",
    "already_registered",
    "not_open_yet",
    "closed",
  ] as const)("names the refusal %s", (error) => {
    expect(registerOutcome({ ok: false, error })).toBe(error);
  });

  it("treats input the page's own buttons never send as not found", () => {
    expect(
      registerOutcome({
        ok: false,
        error: "invalid_input",
        fields: ["competitionId"],
      })
    ).toBe("not_found");
  });

  it("says something went wrong when the use case threw", () => {
    expect(registerOutcome(undefined)).toBe("failed");
  });
});

describe("isRegisterOutcome", () => {
  it("accepts only the outcomes the page can say", () => {
    expect(isRegisterOutcome("registered")).toBe(true);
    expect(isRegisterOutcome("closed")).toBe(true);
    expect(isRegisterOutcome("removed")).toBe(false);
    expect(isRegisterOutcome(undefined)).toBe(false);
    expect(isRegisterOutcome(["registered"])).toBe(false);
  });
});

describe("actingInstitutions", () => {
  it("lists each institution the user coordinates or is the authorised person of, once", () => {
    expect(
      actingInstitutions([
        { role: "member", scope: { type: "global" } },
        {
          role: "institution_coordinator",
          scope: { type: "institution", id: Y },
        },
        { role: "institution_admin", scope: { type: "institution", id: X } },
        {
          role: "institution_coordinator",
          scope: { type: "institution", id: X },
        },
        { role: "judge", scope: { type: "competition", id: X } },
      ])
    ).toEqual([Y, X]);
  });
});

describe("chooseInstitution", () => {
  it("opens the one asked for when the user acts for it, else the first", () => {
    expect(chooseInstitution([X, Y], Y)).toBe(Y);
    expect(chooseInstitution([X, Y], "someone-else")).toBe(X);
    expect(chooseInstitution([X, Y], undefined)).toBe(X);
    expect(chooseInstitution([], X)).toBeUndefined();
  });
});
