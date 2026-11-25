import { describe, expect, it } from "vitest";

import {
  adopterAddressSchema,
  adopterPhoneSchema,
  adoptionAnswersSchema,
} from "./application-input";

const ANSWERS = {
  homeType: "flat",
  hasOutdoorSpace: false,
  otherAnimals: "",
  experience: "Grew up with dogs.",
  whyThisAnimal: "A calm dog suits our small flat and quiet days.",
};

describe("adoption application input", () => {
  it("keeps a phone in E.164 form and refuses anything but an Indian mobile", () => {
    expect(adopterPhoneSchema.parse("098765 43210")).toBe("+919876543210");
    expect(adopterPhoneSchema.safeParse("12345").success).toBe(false);
    expect(adopterPhoneSchema.safeParse("+44 7700 900123").success).toBe(false);
  });

  it("needs an address of 10 to 500 characters, trimmed", () => {
    expect(adopterAddressSchema.parse("  12 MG Road, Pune 411001 ")).toBe(
      "12 MG Road, Pune 411001"
    );
    expect(adopterAddressSchema.safeParse("Pune").success).toBe(false);
    expect(adopterAddressSchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("accepts complete answers and refuses unknown or missing ones", () => {
    expect(adoptionAnswersSchema.parse(ANSWERS)).toEqual(ANSWERS);
    expect(
      adoptionAnswersSchema.safeParse({ ...ANSWERS, salary: "high" }).success
    ).toBe(false);
    expect(
      adoptionAnswersSchema.safeParse({ ...ANSWERS, homeType: "castle" })
        .success
    ).toBe(false);
    expect(
      adoptionAnswersSchema.safeParse({ ...ANSWERS, whyThisAnimal: "Cute" })
        .success
    ).toBe(false);
    expect(
      adoptionAnswersSchema.safeParse({
        ...ANSWERS,
        experience: "x".repeat(1001),
      }).success
    ).toBe(false);
  });
});
