import { describe, expect, it } from "vitest";

import { applicationAnswersSchema } from "./application-answers";

const ANSWERS = {
  homeType: "apartment",
  hasOutdoorSpace: false,
  otherAnimals: "One older cat who is used to dogs.",
  experience: "Grew up with two rescued dogs.",
  availability: "I work from home three days a week.",
};

describe("applicationAnswersSchema", () => {
  it("accepts the four questions, trimmed", () => {
    expect(
      applicationAnswersSchema.parse({
        ...ANSWERS,
        experience: "  Grew up with two rescued dogs.  ",
      })
    ).toEqual(ANSWERS);
  });

  it("allows no other animals", () => {
    expect(
      applicationAnswersSchema.safeParse({ ...ANSWERS, otherAnimals: "" })
        .success
    ).toBe(true);
  });

  it("needs experience and availability", () => {
    for (const field of ["experience", "availability"] as const) {
      const result = applicationAnswersSchema.safeParse({
        ...ANSWERS,
        [field]: "   ",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual([field]);
    }
  });

  it("only takes the listed home types", () => {
    for (const homeType of [
      "apartment",
      "independent_house",
      "shared_accommodation",
      "other",
    ]) {
      expect(
        applicationAnswersSchema.safeParse({ ...ANSWERS, homeType }).success
      ).toBe(true);
    }
    expect(
      applicationAnswersSchema.safeParse({ ...ANSWERS, homeType: "castle" })
        .success
    ).toBe(false);
  });

  it("caps each free-text answer", () => {
    const limits = {
      otherAnimals: 500,
      experience: 1000,
      availability: 500,
    } as const;
    for (const [field, max] of Object.entries(limits)) {
      expect(
        applicationAnswersSchema.safeParse({
          ...ANSWERS,
          [field]: "x".repeat(max),
        }).success
      ).toBe(true);
      expect(
        applicationAnswersSchema.safeParse({
          ...ANSWERS,
          [field]: "x".repeat(max + 1),
        }).success
      ).toBe(false);
    }
  });

  it("rejects fields it doesn't know, so nothing extra lands in the jsonb", () => {
    expect(
      applicationAnswersSchema.safeParse({ ...ANSWERS, phone: "9876543210" })
        .success
    ).toBe(false);
  });
});
