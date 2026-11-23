import { describe, expect, it } from "vitest";

import {
  afterAddChild,
  afterDeclare,
  afterInvite,
  ADD_CHILD_START,
  DECLARE_START,
  isCodeError,
  isChildOutcome,
} from "./form-state";

const DECLARED = { fullName: "Sunita Rao", phone: "", adultDeclared: true };

describe("afterDeclare", () => {
  it("marks the fields to fix and keeps what was typed", () => {
    expect(
      afterDeclare(DECLARE_START, DECLARED, {
        ok: false,
        error: "invalid_input",
        fields: ["fullName", "phone"],
      })
    ).toEqual({
      attempt: 1,
      values: DECLARED,
      errors: ["fullName", "phone"],
      problem: null,
    });
  });

  it("marks the declaration box when it wasn't ticked", () => {
    expect(
      afterDeclare(DECLARE_START, DECLARED, {
        ok: false,
        error: "adult_declaration_required",
      })
    ).toMatchObject({ errors: ["adultDeclared"], problem: null });
  });

  it("says why no code could go, above the form", () => {
    for (const error of [
      "linked_child",
      "registered_as_minor",
      "no_verified_email",
      "rate_limited",
    ] as const) {
      expect(
        afterDeclare(DECLARE_START, DECLARED, { ok: false, error }),
        error
      ).toMatchObject({ errors: [], problem: error });
    }
    expect(afterDeclare(DECLARE_START, DECLARED, "unexpected")).toMatchObject({
      problem: "unexpected",
    });
  });
});

describe("afterAddChild", () => {
  const values = {
    fullName: "Meera Rao",
    dateOfBirth: "2017-04-01",
    relationship: "parent",
  };

  it("ties a date-of-birth refusal to the date field", () => {
    for (const error of ["dob_invalid", "adult"] as const) {
      expect(
        afterAddChild(ADD_CHILD_START, values, { ok: false, error }),
        error
      ).toEqual({
        attempt: 1,
        values,
        errors: ["dateOfBirth"],
        refusal: error,
      });
    }
  });

  it("shows a duplicate above the form, and marks invalid fields", () => {
    expect(
      afterAddChild(ADD_CHILD_START, values, {
        ok: false,
        error: "already_added",
      })
    ).toMatchObject({ errors: [], refusal: "already_added" });
    expect(
      afterAddChild(ADD_CHILD_START, values, {
        ok: false,
        error: "invalid_input",
        fields: ["relationship"],
      })
    ).toMatchObject({ errors: ["relationship"], refusal: null });
  });
});

describe("afterInvite", () => {
  it("keeps the address with the reason it was refused", () => {
    expect(
      afterInvite("arjun", {
        ok: false,
        error: "invalid_input",
        fields: ["email"],
      })
    ).toEqual({ email: "arjun", problem: "invalid_input" });
    expect(
      afterInvite("me@example.test", {
        ok: false,
        error: "invitee_is_guardian",
      })
    ).toEqual({ email: "me@example.test", problem: "invitee_is_guardian" });
    expect(afterInvite("x@example.test", "unexpected")).toEqual({
      email: "x@example.test",
      problem: "unexpected",
    });
  });
});

describe("reading the address bar", () => {
  it("knows only the code errors and outcomes the pages show", () => {
    expect(isCodeError("code_invalid")).toBe(true);
    expect(isCodeError("<script>")).toBe(false);
    expect(isChildOutcome("invited")).toBe(true);
    expect(isChildOutcome(["invited"])).toBe(false);
  });
});
