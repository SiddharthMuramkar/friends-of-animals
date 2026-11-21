import { describe, expect, it } from "vitest";

import { coordinatorMaySubmit } from "./eligibility";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";
const SCHOOL_B = "01938a00-0000-7000-8000-00000000b001";

describe("coordinatorMaySubmit", () => {
  it("lets a coordinator submit for a confirmed student enrolled through their institution", () => {
    expect(
      coordinatorMaySubmit(
        { route: "institution", institutionId: SCHOOL_A, confirmed: true },
        { institutionIds: [SCHOOL_A] }
      )
    ).toEqual({ ok: true });
  });

  it("refuses a student enrolled through another institution", () => {
    expect(
      coordinatorMaySubmit(
        { route: "institution", institutionId: SCHOOL_B, confirmed: true },
        { institutionIds: [SCHOOL_A] }
      )
    ).toEqual({ ok: false, reason: "other_institution" });
  });

  it("lets a coordinator of several institutions submit for any of them", () => {
    expect(
      coordinatorMaySubmit(
        { route: "institution", institutionId: SCHOOL_B, confirmed: true },
        { institutionIds: [SCHOOL_A, SCHOOL_B] }
      )
    ).toEqual({ ok: true });
  });

  it("refuses everyone's students when the coordinator holds no institution", () => {
    expect(
      coordinatorMaySubmit(
        { route: "institution", institutionId: SCHOOL_A, confirmed: true },
        { institutionIds: [] }
      )
    ).toEqual({ ok: false, reason: "other_institution" });
  });

  it("refuses an individual registration, even of a student at the coordinator's school", () => {
    expect(
      coordinatorMaySubmit(
        { route: "individual", institutionId: null, confirmed: true },
        { institutionIds: [SCHOOL_A] }
      )
    ).toEqual({ ok: false, reason: "not_school_route" });
  });

  it("refuses an enrolment that is not confirmed yet", () => {
    expect(
      coordinatorMaySubmit(
        { route: "institution", institutionId: SCHOOL_A, confirmed: false },
        { institutionIds: [SCHOOL_A] }
      )
    ).toEqual({ ok: false, reason: "not_confirmed" });
  });

  it("reports another institution's unconfirmed student as another institution's", () => {
    // Scope is checked first, so a refusal never tells a coordinator
    // anything about a student outside their institution.
    expect(
      coordinatorMaySubmit(
        { route: "institution", institutionId: SCHOOL_B, confirmed: false },
        { institutionIds: [SCHOOL_A] }
      )
    ).toEqual({ ok: false, reason: "other_institution" });
  });
});
