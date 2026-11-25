import { describe, expect, it } from "vitest";

import { assertRowsBelongToSubject, ForeignRowError } from "./guard";

const ME = "0190a000-0000-7000-8000-0000000000aa";
const MY_ENTRY = "0190a000-0000-7000-8000-0000000000bb";
const SOMEONE_ELSE = "0190a000-0000-7000-8000-0000000000cc";

describe("assertRowsBelongToSubject", () => {
  it("passes rows that name the subject or a row already in the export", () => {
    expect(() =>
      assertRowsBelongToSubject(
        "entry_file",
        [
          { id: "f1", entry_id: MY_ENTRY },
          { id: "f2", entry_id: MY_ENTRY },
        ],
        ["entry_id"],
        new Set([ME, MY_ENTRY])
      )
    ).not.toThrow();
    expect(() =>
      assertRowsBelongToSubject(
        "consent_event",
        [{ id: "c1", subject_id: SOMEONE_ELSE, giver_user_id: ME }],
        ["subject_id", "giver_user_id"],
        new Set([ME])
      )
    ).not.toThrow();
  });

  it("refuses a section with one foreign row, naming only its id", () => {
    const attempt = () =>
      assertRowsBelongToSubject(
        "registration",
        [
          { id: "r1", participant_profile_id: ME },
          { id: "r2", participant_profile_id: SOMEONE_ELSE },
        ],
        ["participant_profile_id"],
        new Set([ME])
      );
    expect(attempt).toThrow(ForeignRowError);
    expect(attempt).toThrow("The registration row r2 isn't the subject's");
  });

  it("refuses a row whose owner columns are all empty", () => {
    expect(() =>
      assertRowsBelongToSubject(
        "payment_batch",
        [{ id: "b1", payer_user_id: null }],
        ["payer_user_id"],
        new Set([ME])
      )
    ).toThrow(ForeignRowError);
  });
});
