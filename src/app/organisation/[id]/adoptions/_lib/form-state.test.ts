import { describe, expect, it } from "vitest";

import { adoptionListingDetailsSchema } from "@/server/modules/adoption/domain/details";

import {
  afterResult,
  detailsFrom,
  EMPTY_ANIMAL,
  startWith,
  valuesFrom,
  valuesOf,
} from "./form-state";

function formOf(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("the animal form's state", () => {
  it("turns what was typed into details the use case accepts", () => {
    const values = valuesFrom(
      formOf({
        ...EMPTY_ANIMAL,
        name: "Bruno",
        ageYears: "2",
        ageMonths: "",
        sterilised: "yes",
        size: "",
        conditions: "Home visit.",
        state: "maharashtra",
        city: "Pune",
        pinCode: "411001",
        ignored: "x",
      })
    );
    const details = detailsFrom(values);
    expect(details).toMatchObject({
      name: "Bruno",
      age: { years: 2, months: 0 },
      sterilised: true,
      size: null,
    });
    const parsed = adoptionListingDetailsSchema.parse(details);
    expect(valuesOf(parsed)).toMatchObject({
      name: "Bruno",
      ageYears: "2",
      ageMonths: "0",
      sterilised: "yes",
      breed: "",
    });
  });

  it("sends an age that isn't a whole number as one the use case refuses", () => {
    const details = detailsFrom({ ...EMPTY_ANIMAL, ageYears: "two" });
    expect(Number.isNaN(details.age.years)).toBe(true);
  });

  it("keeps what was typed and marks the refused fields", () => {
    const values = { ...EMPTY_ANIMAL, name: "B" };
    expect(
      afterResult(startWith(EMPTY_ANIMAL), values, {
        ok: false,
        error: "invalid_input",
        fields: ["age", "pinCode", "directoryListingId"],
      })
    ).toEqual({
      attempt: 1,
      values,
      errors: ["age", "pinCode"],
      alert: "invalid_input",
    });
    expect(
      afterResult(startWith(EMPTY_ANIMAL), values, "unexpected").alert
    ).toBe("unexpected");
  });
});
