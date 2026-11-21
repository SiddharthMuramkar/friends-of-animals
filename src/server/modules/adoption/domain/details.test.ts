import { describe, expect, it } from "vitest";

import {
  ADOPTION_SPECIES,
  ADOPTION_TEXT_LIMITS,
  ANIMAL_SEXES,
  ANIMAL_SIZES,
  INDIAN_STATES,
  adoptionListingDetailsSchema,
  graphemeLength,
  isIndianState,
  normalisePlainText,
} from "./details";

const valid = {
  name: "Bruno",
  species: "dog",
  breed: "Indie",
  sex: "male",
  size: "medium",
  colour: "Brown and white",
  age: { years: 2, months: 1 },
  sterilised: true,
  about: "Calm, loves long walks.",
  healthNotes: "Healthy. Dewormed in December.",
  vaccinationNotes: "Anti-rabies and DHPPi, December 2026.",
  conditions: "Indoor home only. Home visit before adoption.",
  state: "maharashtra",
  city: "Pune",
  pinCode: "411001",
};

function issuesOf(input: unknown) {
  const result = adoptionListingDetailsSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message])
  );
}

describe("normalisePlainText", () => {
  it("trims, collapses spaces and drops control characters", () => {
    expect(normalisePlainText("  Bruno \t the\u0007  dog ", false)).toBe(
      "Bruno the dog"
    );
  });

  it("joins lines into one when the field is one line", () => {
    expect(normalisePlainText("Bruno\nthe dog", false)).toBe("Bruno the dog");
  });

  it("keeps paragraphs in a multi-line field, at most one blank line", () => {
    expect(
      normalisePlainText(
        "Calm.  \r\n\r\n\r\n\r\nLoves walks.\rEats well.",
        true
      )
    ).toBe("Calm.\n\nLoves walks.\nEats well.");
  });

  it("drops bidirectional overrides that can disguise text", () => {
    expect(normalisePlainText("Bru‮no⁦", false)).toBe("Bruno");
  });

  it("keeps emoji joiners and composes accents", () => {
    expect(normalisePlainText("Café 🐕‍🦺", false)).toBe("Café 🐕‍🦺");
    expect(graphemeLength("Café 🐕‍🦺")).toBe(6);
  });
});

describe("adoptionListingDetailsSchema", () => {
  it("lists the species, sexes and sizes the schema enums are built from", () => {
    expect(ADOPTION_SPECIES).toEqual(["dog", "cat", "rabbit", "bird", "other"]);
    expect(ANIMAL_SEXES).toEqual(["female", "male", "unknown"]);
    expect(ANIMAL_SIZES).toEqual(["small", "medium", "large"]);
  });

  it("accepts a complete listing and normalises its text", () => {
    const parsed = adoptionListingDetailsSchema.parse({
      ...valid,
      name: "  Bruno  ",
      about: "Calm.\n\n\n\nLoves walks.",
    });
    expect(parsed.name).toBe("Bruno");
    expect(parsed.about).toBe("Calm.\n\nLoves walks.");
    expect(parsed.pinCode).toBe("411001");
  });

  it("turns blank optional fields into null", () => {
    const parsed = adoptionListingDetailsSchema.parse({
      ...valid,
      breed: "   ",
      colour: "",
      size: null,
      sterilised: null,
      about: "",
      healthNotes: "",
      vaccinationNotes: " ",
    });
    expect(parsed).toMatchObject({
      breed: null,
      colour: null,
      size: null,
      sterilised: null,
      about: null,
      healthNotes: null,
      vaccinationNotes: null,
    });
  });

  it("requires a name, adoption conditions and a city", () => {
    expect(
      issuesOf({ ...valid, name: "  ", conditions: "", city: "" })
    ).toEqual({ name: "required", conditions: "required", city: "required" });
  });

  it("counts length in characters as people see them", () => {
    const max = ADOPTION_TEXT_LIMITS.nameMax;
    expect(issuesOf({ ...valid, name: "🐕".repeat(max) })).toEqual({});
    expect(issuesOf({ ...valid, name: "a".repeat(max + 1) })).toEqual({
      name: "too_long",
    });
    expect(
      issuesOf({
        ...valid,
        conditions: "a".repeat(ADOPTION_TEXT_LIMITS.conditionsMax + 1),
      })
    ).toEqual({ conditions: "too_long" });
  });

  it("refuses an unknown species, sex, size or state", () => {
    expect(
      Object.keys(
        issuesOf({
          ...valid,
          species: "tiger",
          sex: "x",
          size: "huge",
          state: "atlantis",
        })
      ).sort()
    ).toEqual(["sex", "size", "species", "state"]);
  });

  it.each(["011001", "41100", "4110011", "41100a", ""])(
    "refuses the PIN code %j",
    (pinCode) => {
      expect(issuesOf({ ...valid, pinCode })).toHaveProperty("pinCode");
    }
  );

  it("refuses an age outside 0-60 years and 0-11 months", () => {
    expect(
      issuesOf({ ...valid, age: { years: 61, months: 0 } })
    ).toHaveProperty("age.years");
    expect(
      issuesOf({ ...valid, age: { years: 1, months: 12 } })
    ).toHaveProperty("age.months");
    expect(
      issuesOf({ ...valid, age: { years: 1.5, months: 0 } })
    ).toHaveProperty("age.years");
  });
});

describe("INDIAN_STATES", () => {
  it("has the 28 states and 8 union territories, keys unique", () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(new Set(INDIAN_STATES.map((s) => s.key)).size).toBe(36);
    expect(
      INDIAN_STATES.filter((s) => s.kind === "union_territory")
    ).toHaveLength(8);
  });

  it("recognises its own keys only", () => {
    expect(isIndianState("tamil_nadu")).toBe(true);
    expect(isIndianState("Tamil Nadu")).toBe(false);
  });
});
