import { describe, expect, it } from "vitest";

import { parseStudentDetails, type StudentInput } from "./student-details";

// Stands in for #58's E.164 normaliser: ten digits from 6-9, +91 optional.
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "").replace(/^\+91/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const TODAY = { year: 2027, month: 1, day: 15 };
const parse = (input: StudentInput) =>
  parseStudentDetails(input, { today: TODAY, normalisePhone });

const CHILD: StudentInput = {
  fullName: "  Aanya   Rao ",
  dateOfBirth: "2016-03-09",
  grade: "Class 5",
  guardianName: "Kavita Rao",
  guardianRelationship: "parent",
  guardianPhone: "98765 43210",
};

// 18 today: the youngest adult.
const ADULT: StudentInput = {
  fullName: "Vikram Nair",
  dateOfBirth: "2009-01-15",
  phone: "+91 91234 56789",
  email: " Vikram.Nair@Example.TEST ",
};

describe("parseStudentDetails for a minor", () => {
  it("returns the cleaned details with the guardian as the contact", () => {
    expect(parse(CHILD)).toEqual({
      ok: true,
      ignored: [],
      value: {
        fullName: "Aanya Rao",
        dateOfBirth: { year: 2016, month: 3, day: 9 },
        isMinor: true,
        grade: "Class 5",
        studentRef: null,
        address: null,
        pinCode: null,
        city: null,
        state: null,
        contact: {
          kind: "guardian",
          name: "Kavita Rao",
          relationship: "parent",
          phone: "+919876543210",
          email: null,
        },
      },
    });
  });

  it.each(["guardianName", "guardianRelationship", "guardianPhone"] as const)(
    "requires %s",
    (field) => {
      expect(parse({ ...CHILD, [field]: "  " })).toEqual({
        ok: false,
        errors: { [field]: "required" },
      });
    }
  );

  it("drops a child's own phone and email, and says so", () => {
    const result = parse({
      ...CHILD,
      phone: "9123456789",
      email: "kid@example.test",
    });
    expect(result).toMatchObject({ ok: true, ignored: ["phone", "email"] });
    expect(result.ok && result.value.contact.kind).toBe("guardian");
  });

  it("reads a legal guardian written in words", () => {
    const result = parse({ ...CHILD, guardianRelationship: "Legal Guardian" });
    expect(result.ok && result.value.contact).toMatchObject({
      relationship: "legal_guardian",
    });
  });

  it("refuses an unknown relationship", () => {
    expect(parse({ ...CHILD, guardianRelationship: "uncle" })).toEqual({
      ok: false,
      errors: { guardianRelationship: "invalid_choice" },
    });
  });

  it("checks the guardian's phone and email", () => {
    expect(
      parse({ ...CHILD, guardianPhone: "12345", guardianEmail: "not-an-email" })
    ).toEqual({
      ok: false,
      errors: {
        guardianPhone: "invalid_phone",
        guardianEmail: "invalid_email",
      },
    });
  });

  it("treats someone who turns 18 tomorrow as a minor", () => {
    expect(
      parse({ ...ADULT, ...CHILD, dateOfBirth: "2009-01-16" })
    ).toMatchObject({ ok: true, value: { isMinor: true } });
  });
});

describe("parseStudentDetails for an adult", () => {
  it("returns the student's own phone and email, from the 18th birthday", () => {
    const result = parse(ADULT);
    expect(result).toMatchObject({
      ok: true,
      ignored: [],
      value: {
        isMinor: false,
        contact: {
          kind: "self",
          phone: "+919123456789",
          email: "vikram.nair@example.test",
        },
      },
    });
  });

  it("requires the adult's own phone", () => {
    expect(parse({ ...ADULT, phone: "" })).toEqual({
      ok: false,
      errors: { phone: "required" },
    });
  });

  it("drops guardian details for an adult, and says so", () => {
    expect(
      parse({ ...ADULT, guardianName: "Someone", guardianPhone: "9876543210" })
    ).toMatchObject({ ok: true, ignored: ["guardianName", "guardianPhone"] });
  });
});

describe("parseStudentDetails fields", () => {
  it("reads a day-first date with slashes", () => {
    expect(parse({ ...CHILD, dateOfBirth: "09/03/2016" })).toMatchObject({
      ok: true,
      value: { dateOfBirth: { year: 2016, month: 3, day: 9 } },
    });
  });

  it.each([
    ["missing", "", "required"],
    ["not a date", "9 March 2016", "invalid_date"],
    ["impossible", "2015-02-29", "invalid_date"],
    ["impossible, day first", "31/04/2016", "invalid_date"],
    ["after today", "2027-01-16", "in_future"],
    ["before 1900", "1899-12-31", "too_early"],
  ])("refuses a date of birth that is %s", (_case, dateOfBirth, error) => {
    expect(parse({ ...CHILD, dateOfBirth })).toEqual({
      ok: false,
      errors: { dateOfBirth: error },
    });
  });

  it("still checks contact formats when the date of birth is wrong", () => {
    expect(parse({ ...CHILD, dateOfBirth: "", guardianPhone: "12" })).toEqual({
      ok: false,
      errors: { dateOfBirth: "required", guardianPhone: "invalid_phone" },
    });
  });

  it.each([
    ["", "required"],
    ["A", "too_short"],
    ["A".repeat(101), "too_long"],
  ])("refuses the name %j", (fullName, error) => {
    expect(parse({ ...CHILD, fullName })).toEqual({
      ok: false,
      errors: { fullName: error },
    });
  });

  it("counts characters, not UTF-16 units, in names", () => {
    expect(parse({ ...CHILD, fullName: "😀".repeat(100) }).ok).toBe(true);
  });

  it("keeps optional fields, trimmed, and pin codes without spaces", () => {
    const result = parse({
      ...CHILD,
      studentRef: " R-17 ",
      address: " 12 Lake Road ",
      pinCode: "560 001",
      city: "Bengaluru",
      state: "Karnataka",
      guardianEmail: "Kavita@Example.test",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        studentRef: "R-17",
        address: "12 Lake Road",
        pinCode: "560001",
        city: "Bengaluru",
        state: "Karnataka",
        contact: { email: "kavita@example.test" },
      },
    });
  });

  it.each([
    ["pinCode", "060001", "invalid_format"],
    ["pinCode", "56001", "invalid_format"],
    ["grade", "x".repeat(21), "too_long"],
    ["studentRef", "x".repeat(41), "too_long"],
    ["address", "x".repeat(301), "too_long"],
    ["city", "x".repeat(61), "too_long"],
    ["state", "x".repeat(61), "too_long"],
  ] as const)("refuses %s %j", (field, value, error) => {
    expect(parse({ ...CHILD, [field]: value })).toEqual({
      ok: false,
      errors: { [field]: error },
    });
  });

  it("reports every bad field at once", () => {
    expect(parse({ fullName: "", dateOfBirth: "", pinCode: "1" })).toEqual({
      ok: false,
      errors: {
        fullName: "required",
        dateOfBirth: "required",
        pinCode: "invalid_format",
      },
    });
  });
});
