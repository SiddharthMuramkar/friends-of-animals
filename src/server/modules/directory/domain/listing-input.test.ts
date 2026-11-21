import { describe, expect, it } from "vitest";

import {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
} from "./catalogue";
import { parseListingInput } from "./listing-input";

// Stands in for #58's Indian-mobile parser: accepts ten digits starting 6-9,
// with an optional +91, and returns E.164.
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+91/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const VALID = {
  type: "ngo",
  name: "Paws and Whiskers Trust",
  description: "We rescue injured street dogs in Pune.\nOpen every day.",
  services: ["rescue", "veterinary_care"],
  address: "12 Lane 4, Koregaon Park",
  city: "Pune",
  state: "Maharashtra",
  pinCode: "411001",
  contactPhone: "+91 98765 43210",
  contactEmail: "Help@PawsTrust.example",
  website: "https://pawstrust.example/adopt",
  publicContactFields: ["phone", "email"],
};

function parse(overrides: Record<string, unknown> = {}) {
  return parseListingInput({ ...VALID, ...overrides }, { normalisePhone });
}

function errorsOf(overrides: Record<string, unknown>) {
  const result = parse(overrides);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

describe("the catalogue", () => {
  it("names five listing types, nine services and three public contacts", () => {
    expect(LISTING_TYPES).toEqual([
      "ngo",
      "rescue_organisation",
      "shelter",
      "independent_rescuer",
      "foster_caregiver",
    ]);
    expect(DIRECTORY_SERVICES).toEqual([
      "rescue",
      "shelter",
      "veterinary_care",
      "ambulance",
      "adoption",
      "fostering",
      "feeding",
      "sterilisation",
      "education",
    ]);
    expect(PUBLIC_CONTACT_FIELDS).toEqual(["phone", "email", "website"]);
  });
});

describe("parseListingInput", () => {
  it("reads a valid listing into its stored form", () => {
    expect(parse()).toEqual({
      ok: true,
      value: {
        type: "ngo",
        name: "Paws and Whiskers Trust",
        description: "We rescue injured street dogs in Pune.\nOpen every day.",
        services: ["rescue", "veterinary_care"],
        address: "12 Lane 4, Koregaon Park",
        city: "Pune",
        state: "Maharashtra",
        pinCode: "411001",
        contactPhone: "+919876543210",
        contactEmail: "help@pawstrust.example",
        website: "https://pawstrust.example/adopt",
        publicContactFields: ["phone", "email"],
      },
    });
  });

  it("collapses spaces in names and places, and trims everything", () => {
    const result = parse({
      name: "  Paws   and Whiskers\tTrust ",
      city: " Navi   Mumbai ",
      state: " Maharashtra ",
      address: "  12 Lane 4,\n Koregaon Park  ",
      description: "  Line one.\n\nLine two.  ",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        name: "Paws and Whiskers Trust",
        city: "Navi Mumbai",
        state: "Maharashtra",
        address: "12 Lane 4,\n Koregaon Park",
        description: "Line one.\n\nLine two.",
      },
    });
  });

  it("keeps services and public contacts in catalogue order, once each", () => {
    expect(
      parse({
        services: ["feeding", "rescue", "feeding"],
        publicContactFields: ["website", "phone", "phone"],
      })
    ).toMatchObject({
      ok: true,
      value: {
        services: ["rescue", "feeding"],
        publicContactFields: ["phone", "website"],
      },
    });
  });

  it("accepts a single service sent as a string, as a form posts it", () => {
    expect(parse({ services: "shelter" })).toMatchObject({
      ok: true,
      value: { services: ["shelter"] },
    });
  });

  it("treats missing optional contacts as none", () => {
    expect(
      parse({ contactEmail: "  ", website: undefined, publicContactFields: [] })
    ).toMatchObject({
      ok: true,
      value: { contactEmail: null, website: null, publicContactFields: [] },
    });
  });

  it("adds https:// to a bare website address", () => {
    expect(parse({ website: "pawstrust.example" })).toMatchObject({
      ok: true,
      value: { website: "https://pawstrust.example/" },
    });
  });

  it.each([
    [{ type: "zoo" }, { type: "invalid" }],
    [{ type: undefined }, { type: "required" }],
    [{ name: " " }, { name: "required" }],
    [{ name: "A" }, { name: "too_short" }],
    [{ name: "x".repeat(121) }, { name: "too_long" }],
    [{ description: "" }, { description: "required" }],
    [{ description: "x".repeat(2001) }, { description: "too_long" }],
    [{ services: [] }, { services: "required" }],
    [{ services: ["rescue", "grooming"] }, { services: "invalid" }],
    [{ services: 3 }, { services: "invalid" }],
    [{ address: "" }, { address: "required" }],
    [{ address: "x".repeat(301) }, { address: "too_long" }],
    [{ city: "" }, { city: "required" }],
    [{ city: "x".repeat(81) }, { city: "too_long" }],
    [{ state: "" }, { state: "required" }],
    [{ pinCode: "011001" }, { pinCode: "invalid" }],
    [{ pinCode: "41100" }, { pinCode: "invalid" }],
    [{ pinCode: "" }, { pinCode: "required" }],
    [{ contactPhone: "" }, { contactPhone: "required" }],
    [{ contactPhone: "020 2612 3456" }, { contactPhone: "invalid" }],
    [{ contactEmail: "not-an-email" }, { contactEmail: "invalid" }],
    [{ website: "javascript:alert(1)" }, { website: "invalid" }],
    [{ website: "ftp://pawstrust.example" }, { website: "invalid" }],
    [{ website: "localhost" }, { website: "invalid" }],
    [
      { website: `https://x.example/${"a".repeat(200)}` },
      { website: "too_long" },
    ],
    [{ publicContactFields: ["address"] }, { publicContactFields: "invalid" }],
    [
      { contactEmail: "", publicContactFields: ["email"] },
      { publicContactFields: "chosen_contact_missing" },
    ],
    [
      { website: "", publicContactFields: ["website"] },
      { publicContactFields: "chosen_contact_missing" },
    ],
  ])("refuses %j with %j", (overrides, expected) => {
    expect(errorsOf(overrides)).toEqual(expected);
  });

  it("reports every bad field at once", () => {
    expect(
      errorsOf({ name: "", pinCode: "1", services: [], contactPhone: "12" })
    ).toEqual({
      name: "required",
      pinCode: "invalid",
      services: "required",
      contactPhone: "invalid",
    });
  });

  it("refuses something that isn't an object", () => {
    expect(parseListingInput(null, { normalisePhone })).toMatchObject({
      ok: false,
      errors: { type: "required", name: "required" },
    });
  });

  it("never makes the address public, whatever is posted", () => {
    expect(errorsOf({ publicContactFields: ["phone", "address"] })).toEqual({
      publicContactFields: "invalid",
    });
  });
});
