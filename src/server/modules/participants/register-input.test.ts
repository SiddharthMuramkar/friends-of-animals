import { describe, expect, it } from "vitest";

import { countryOptions, parseRegisterInput } from "./register-input";

const TERMS = "01938a00-0000-7000-8000-00000000d001";
const PRIVACY = "01938a00-0000-7000-8000-00000000d002";

const form = {
  competitionSlug: "neighbours-on-my-street",
  fullName: "Asha Rao",
  dateOfBirth: "1995-08-20",
  phone: "+91 98765 43210",
  pinCode: "560001",
  city: "Bengaluru",
  state: "Karnataka",
  country: "IN",
  schoolName: "",
  consents: [TERMS, PRIVACY],
};

describe("parseRegisterInput", () => {
  it("reads the individual form, trimmed, with no school name as null", () => {
    expect(
      parseRegisterInput({
        ...form,
        fullName: "  Asha   Rao ",
        city: " Bengaluru ",
        schoolName: "   ",
      })
    ).toEqual({
      ok: true,
      value: {
        competitionSlug: "neighbours-on-my-street",
        fullName: "Asha Rao",
        dateOfBirth: "1995-08-20",
        // E.164, by #58's rules for Indian mobiles.
        phone: "+919876543210",
        pinCode: "560001",
        city: "Bengaluru",
        state: "Karnataka",
        country: "IN",
        schoolName: null,
        consents: [TERMS, PRIVACY],
      },
    });
  });

  it("keeps a school or college name when one is given", () => {
    const parsed = parseRegisterInput({
      ...form,
      schoolName: " St. Joseph's College ",
    });
    expect(parsed.ok && parsed.value.schoolName).toBe("St. Joseph's College");
  });

  it("takes each ticked consent once, and none when the form has none", () => {
    const twice = parseRegisterInput({
      ...form,
      consents: [PRIVACY, TERMS, PRIVACY],
    });
    expect(twice.ok && twice.value.consents).toEqual([PRIVACY, TERMS]);

    const { consents: _, ...withoutConsents } = form;
    const none = parseRegisterInput(withoutConsents);
    expect(none.ok && none.value.consents).toEqual([]);
  });

  it("reads an Indian PIN code written with a space", () => {
    const parsed = parseRegisterInput({ ...form, pinCode: "560 001" });
    expect(parsed.ok && parsed.value.pinCode).toBe("560001");
  });

  it("accepts a postal code from outside India", () => {
    const parsed = parseRegisterInput({
      ...form,
      country: "np",
      pinCode: "44600",
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      country: "NP",
      pinCode: "44600",
    });
  });

  it.each([
    ["a blank name", { fullName: "  " }, ["fullName"]],
    ["a one-letter name", { fullName: "A" }, ["fullName"]],
    ["a name over 100 characters", { fullName: "A".repeat(101) }, ["fullName"]],
    ["no date of birth", { dateOfBirth: "" }, ["dateOfBirth"]],
    ["no phone number", { phone: " " }, ["phone"]],
    [
      "a phone number that isn't an Indian mobile",
      { phone: "12345" },
      ["phone"],
    ],
    ["a landline", { phone: "020 2567 8901" }, ["phone"]],
    ["a five-digit PIN code in India", { pinCode: "56001" }, ["pinCode"]],
    ["an Indian PIN code starting with 0", { pinCode: "060001" }, ["pinCode"]],
    ["letters in an Indian PIN code", { pinCode: "56OO01" }, ["pinCode"]],
    [
      "a postal code with symbols",
      { country: "NP", pinCode: "44#00" },
      ["pinCode"],
    ],
    ["no city", { city: "" }, ["city"]],
    ["no state", { state: "" }, ["state"]],
    ["a country that is not a country code", { country: "India" }, ["country"]],
    ["an unknown country code", { country: "XX" }, ["country"]],
    ["a region that isn't a country", { country: "EU" }, ["country"]],
    [
      "a competition that is not a slug",
      { competitionSlug: "Neighbours!" },
      ["competitionSlug"],
    ],
    [
      "a consent that is not a document id",
      { consents: ["terms"] },
      ["consents"],
    ],
    [
      "several problems at once",
      { fullName: "", city: "", pinCode: "1" },
      ["fullName", "pinCode", "city"],
    ],
  ])("refuses %s, naming the field", (_, change, fields) => {
    expect(parseRegisterInput({ ...form, ...change })).toEqual({
      ok: false,
      fields,
    });
  });

  it("refuses something that is not a form at all", () => {
    expect(parseRegisterInput(null)).toMatchObject({ ok: false });
    expect(parseRegisterInput("Asha Rao")).toMatchObject({ ok: false });
  });
});

describe("countryOptions", () => {
  it("offers India first, then every country by name, each one the form takes", () => {
    const options = countryOptions();
    expect(options[0]).toEqual({ value: "IN", label: "India" });
    expect(options).toContainEqual({ value: "NP", label: "Nepal" });
    expect(options.map((o) => o.value)).not.toContain("EU");
    for (const { value } of options) {
      const pinCode = value === "IN" ? "560001" : "44600";
      expect(
        parseRegisterInput({ ...form, country: value, pinCode }).ok,
        value
      ).toBe(true);
    }
  });
});
