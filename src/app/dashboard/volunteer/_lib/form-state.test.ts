import { describe, expect, it } from "vitest";

import {
  applyInputOf,
  declarationsTicked,
  readApplyForm,
  refused,
} from "./form-state";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("the volunteer application form's state", () => {
  it("reads every ticked box and typed field, and builds the use case's input", () => {
    const values = readApplyForm(
      form([
        ["interests", "outreach"],
        ["interests", "technology"],
        ["slots", "saturday:morning"],
        ["slots", "monday:evening"],
        ["note", "Holidays"],
        ["dateOfBirth", "1990-01-15"],
        ["safeguardingDocumentId", "s-1"],
        ["conductDocumentId", "c-1"],
      ])
    );

    expect(declarationsTicked(values)).toBe(true);
    expect(applyInputOf(values)).toEqual({
      interests: ["outreach", "technology"],
      availability: {
        slots: [
          { day: "saturday", part: "morning" },
          { day: "monday", part: "evening" },
        ],
        note: "Holidays",
      },
      dateOfBirth: "1990-01-15",
      safeguardingDocumentId: "s-1",
      conductDocumentId: "c-1",
    });
  });

  it("sends no date of birth when the form didn't ask for one, and notices an unticked declaration", () => {
    const values = readApplyForm(
      form([
        ["interests", "content"],
        ["safeguardingDocumentId", "s-1"],
      ])
    );

    expect(declarationsTicked(values)).toBe(false);
    expect(applyInputOf(values)).not.toHaveProperty("dateOfBirth");
  });

  it("keeps what was sent after a refusal and points at the fields at fault", () => {
    const values = readApplyForm(form([["note", "Weekends"]]));

    expect(
      refused(values, "invalid_input", ["interests", "availability", "other"])
    ).toEqual({
      problem: "invalid_input",
      fields: ["interests", "availability"],
      values,
    });
    expect(refused(values, "declaration_outdated").fields).toEqual([
      "declarations",
    ]);
    expect(refused(values, "under_min_age").fields).toEqual(["dateOfBirth"]);
    expect(refused(values, "application_open").fields).toEqual([]);
  });
});
