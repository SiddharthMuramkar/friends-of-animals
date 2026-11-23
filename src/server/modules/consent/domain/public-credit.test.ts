import { describe, expect, it } from "vitest";

import { GUARDIAN_PURPOSES, type GuardianPurpose } from "./guardian-purposes";
import {
  nameParts,
  resolvePublicCredit,
  type CreditPerson,
} from "./public-credit";

const asha: CreditPerson = {
  firstName: "Asha",
  lastName: "Kulkarni",
  schoolName: "Green Valley School",
  city: "Pune",
  minor: true,
};

describe("resolvePublicCredit", () => {
  it("credits a minor with public display consent as first name plus last initial", () => {
    expect(
      resolvePublicCredit(asha, "gallery", new Set(["public_display"]))
    ).toEqual({ name: "Asha K." });
  });

  it("gives no credit at all when the use has no consent", () => {
    expect(resolvePublicCredit(asha, "gallery", new Set())).toBeNull();
    expect(
      resolvePublicCredit(
        asha,
        "gallery",
        new Set(["participation", "display_school", "display_city"])
      )
    ).toBeNull();
  });

  it("adds the school and the city only for the fields the guardian opted in to", () => {
    const credit = (...extra: GuardianPurpose[]) =>
      resolvePublicCredit(
        asha,
        "gallery",
        new Set(["public_display", ...extra])
      );

    expect(credit("display_school")).toEqual({
      name: "Asha K.",
      school: "Green Valley School",
    });
    expect(credit("display_city")).toEqual({ name: "Asha K.", city: "Pune" });
    expect(credit("display_school", "display_city")).toEqual({
      name: "Asha K.",
      school: "Green Valley School",
      city: "Pune",
    });
  });

  it("leaves out an opted-in field the profile has no value for", () => {
    expect(
      resolvePublicCredit(
        { ...asha, schoolName: null, city: "   " },
        "gallery",
        new Set(["public_display", "display_school", "display_city"])
      )
    ).toEqual({ name: "Asha K." });
  });

  it.each([
    ["gallery", "public_display"],
    ["results", "public_display"],
    ["social_media", "social_media"],
    ["auction", "auction"],
  ] as const)("credits on %s only with %s consent", (use, purpose) => {
    const others = GUARDIAN_PURPOSES.filter((p) => p !== purpose);
    expect(resolvePublicCredit(asha, use, new Set(others))).toBeNull();
    expect(resolvePublicCredit(asha, use, new Set([purpose]))).toEqual({
      name: "Asha K.",
    });
  });

  it("shows the opted-in school and city on social media too", () => {
    expect(
      resolvePublicCredit(
        asha,
        "social_media",
        new Set(["social_media", "display_school", "display_city"])
      )
    ).toEqual({ name: "Asha K.", school: "Green Valley School", city: "Pune" });
  });

  it("caps a minor's auction credit at first name and initial, whatever else is opted in", () => {
    expect(
      resolvePublicCredit(asha, "auction", new Set(GUARDIAN_PURPOSES))
    ).toEqual({ name: "Asha K." });
  });

  describe("the minor's name", () => {
    const nameOf = (firstName: string, lastName: string) =>
      resolvePublicCredit(
        { firstName, lastName, minor: true },
        "gallery",
        new Set(["public_display"])
      )?.name;

    it("takes the whole first letter of a Devanagari surname, vowel sign included", () => {
      expect(nameOf("आशा", "कुमार")).toBe("आशा कु.");
    });

    it("keeps an accent with its letter and capitalises it", () => {
      // "é" typed as e + combining acute accent, then normalised.
      expect(nameOf("Zoë", "e\u0301tienne")).toBe("Zoë É.");
    });

    it("capitalises a lower-case initial", () => {
      expect(nameOf("Meera", "de Souza")).toBe("Meera D.");
    });

    it("skips punctuation before the first letter of the surname", () => {
      expect(nameOf("Kavya", "'Dsouza")).toBe("Kavya D.");
    });

    it("tidies stray spaces in the first name", () => {
      expect(nameOf("  Asha   Rani ", " Kulkarni")).toBe("Asha Rani K.");
    });

    it("is just the first name when there is no surname", () => {
      expect(nameOf("Asha", "  ")).toBe("Asha");
    });

    it("never contains more of the surname than its initial", () => {
      expect(nameOf("Asha", "Kulkarni")).not.toContain("Ku");
    });
  });

  describe("an adult", () => {
    const ravi: CreditPerson = {
      firstName: "Ravi",
      lastName: " Iyer ",
      schoolName: "City College",
      city: "Chennai",
      minor: false,
    };

    it("is credited by full name", () => {
      expect(
        resolvePublicCredit(ravi, "gallery", new Set(["public_display"]))
      ).toEqual({ name: "Ravi Iyer" });
    });

    it("keeps opted-in school and city at auction: the cap protects minors", () => {
      expect(
        resolvePublicCredit(
          ravi,
          "auction",
          new Set(["auction", "display_school", "display_city"])
        )
      ).toEqual({ name: "Ravi Iyer", school: "City College", city: "Chennai" });
    });
  });

  it("gives no credit when there is no name to show", () => {
    expect(
      resolvePublicCredit(
        { firstName: " ", lastName: "", minor: true },
        "gallery",
        new Set(["public_display"])
      )
    ).toBeNull();
  });
});

describe("nameParts", () => {
  it("takes the first word as the first name and the last as the surname", () => {
    expect(nameParts("Asha Kulkarni")).toEqual({
      firstName: "Asha",
      lastName: "Kulkarni",
    });
  });

  it("leaves middle names out of both, so a credit shows no more than first name and initial", () => {
    expect(nameParts("  Asha   Rani Kulkarni ")).toEqual({
      firstName: "Asha",
      lastName: "Kulkarni",
    });
  });

  it("has no surname for a single name", () => {
    expect(nameParts("Zoya")).toEqual({ firstName: "Zoya", lastName: "" });
  });

  it("splits a Devanagari name the same way", () => {
    const { firstName, lastName } = nameParts("आशा कुलकर्णी");
    expect(
      resolvePublicCredit(
        { firstName, lastName, minor: true },
        "gallery",
        new Set(["public_display"])
      )
    ).toEqual({ name: "आशा कु." });
  });
});
