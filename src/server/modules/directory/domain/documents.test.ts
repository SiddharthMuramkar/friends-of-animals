import { describe, expect, it } from "vitest";

import { DOCUMENT_KINDS, documentChecklist } from "./documents";

describe("document kinds", () => {
  it("names five kinds of proof", () => {
    expect(DOCUMENT_KINDS).toEqual([
      "registration_certificate",
      "awbi_recognition",
      "identity_proof",
      "address_proof",
      "other",
    ]);
  });
});

describe("documentChecklist", () => {
  it.each(["ngo", "rescue_organisation", "shelter"] as const)(
    "asks a %s for its registration, with AWBI recognition optional",
    (type) => {
      expect(documentChecklist(type, [])).toEqual([
        {
          kind: "registration_certificate",
          expected: "required",
          provided: false,
        },
        { kind: "awbi_recognition", expected: "optional", provided: false },
      ]);
    }
  );

  it.each(["independent_rescuer", "foster_caregiver"] as const)(
    "asks a %s for identity proof, with address proof optional",
    (type) => {
      expect(documentChecklist(type, [])).toEqual([
        { kind: "identity_proof", expected: "required", provided: false },
        { kind: "address_proof", expected: "optional", provided: false },
      ]);
    }
  );

  it("ticks what was uploaded and lists other uploads after", () => {
    expect(
      documentChecklist("ngo", [
        "other",
        "registration_certificate",
        "registration_certificate",
        "identity_proof",
      ])
    ).toEqual([
      {
        kind: "registration_certificate",
        expected: "required",
        provided: true,
      },
      { kind: "awbi_recognition", expected: "optional", provided: false },
      { kind: "identity_proof", expected: "extra", provided: true },
      { kind: "other", expected: "extra", provided: true },
    ]);
  });
});
