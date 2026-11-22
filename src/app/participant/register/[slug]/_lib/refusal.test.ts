import { describe, expect, it } from "vitest";

import en from "../../../../../../messages/en-IN/participant.json";

import { refusalBeforeForm, refusalView } from "./refusal";

const REFUSALS = [
  "registration_closed",
  "institutions_only",
  "dob_invalid",
  "minor",
  "already_registered",
  "consent_missing",
] as const;

/** The participant namespace's message at a dotted key, if there is one. */
function messageAt(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (tree, part) =>
        typeof tree === "object" && tree !== null
          ? (tree as Record<string, unknown>)[part]
          : undefined,
      en.participant
    );
}

describe("refusalView", () => {
  it.each(REFUSALS)("has words for a %s refusal", (reason) => {
    const message = messageAt(refusalView(reason).message);
    expect(typeof message === "string" && message.trim()).toBeTruthy();
  });

  it("answers a minor with the come-back pointer", () => {
    expect(refusalView("minor").message).toBe("register.minor");
  });

  it("puts a refusal the person can fix on the field that needs fixing", () => {
    expect(refusalView("dob_invalid").field).toBe("dateOfBirth");
    expect(refusalView("minor").field).toBe("dateOfBirth");
    expect(refusalView("consent_missing").field).toBe("consents");
  });

  it("shows the competition's own refusals above the form", () => {
    expect(refusalView("registration_closed").field).toBeUndefined();
    expect(refusalView("institutions_only").field).toBeUndefined();
    expect(refusalView("already_registered").field).toBeUndefined();
  });
});

describe("refusalBeforeForm", () => {
  const fee = { amountMinor: 10_000n, currency: "INR" } as const;

  it("shows the form when the competition takes individuals at a set fee", () => {
    expect(refusalBeforeForm({ acceptsIndividuals: true, fee })).toBeNull();
    expect(
      refusalBeforeForm({
        acceptsIndividuals: true,
        fee: { amountMinor: 0n, currency: "INR" },
      })
    ).toBeNull();
  });

  it("says a competition only takes institutions before anything is typed", () => {
    expect(refusalBeforeForm({ acceptsIndividuals: false, fee })).toBe(
      "institutions_only"
    );
    expect(refusalBeforeForm({ acceptsIndividuals: false, fee: null })).toBe(
      "institutions_only"
    );
  });

  it("says the fee isn't set yet before anything is typed", () => {
    expect(refusalBeforeForm({ acceptsIndividuals: true, fee: null })).toBe(
      "fee_not_set"
    );
  });
});
