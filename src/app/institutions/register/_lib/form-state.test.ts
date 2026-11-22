import { describe, expect, it } from "vitest";

import { afterResult, START, valuesFrom } from "./form-state";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

describe("the registration form's state", () => {
  it("starts empty, with India as the country", () => {
    expect(START.values.country).toBe("India");
    expect(START.values.name).toBe("");
    expect(START.errors).toEqual([]);
  });

  it("reads every field as text, and nothing else the browser sends", () => {
    const values = valuesFrom(
      form({ name: "Sunrise School", expectedParticipants: "240", extra: "x" })
    );

    expect(values).toMatchObject({
      name: "Sunrise School",
      expectedParticipants: "240",
      city: "",
    });
    expect(values).not.toHaveProperty("extra");
  });

  it("keeps what was typed and marks the fields the use case refused", () => {
    const values = { ...START.values, pinCode: "011001" };

    const next = afterResult(START, values, {
      ok: false,
      error: "invalid_input",
      fields: ["pinCode", "notAField"],
    });

    expect(next).toEqual({
      attempt: 1,
      values,
      errors: ["pinCode"],
      alert: "invalid_input",
    });
  });

  it("says when the person already has an open registration", () => {
    expect(
      afterResult(START, START.values, {
        ok: false,
        error: "already_registered",
      })
    ).toMatchObject({ errors: [], alert: "already_registered" });
  });
});
