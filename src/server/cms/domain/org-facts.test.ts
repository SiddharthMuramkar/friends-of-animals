import { describe, expect, it } from "vitest";

import { placeholder } from "../../../lib/site";
import { factsKind } from "../kinds/facts";
import {
  EMPTY_TAX_FACTS,
  legalFactValue,
  mergeOrgFacts,
  missingOrgFacts,
} from "./org-facts";

const siteFacts = {
  email: "hello@friendsofanimals.example",
  phone: "+91 80 1234 5678",
  address: "12 Example Road, Bengaluru 560001",
  socials: ["https://www.instagram.com/example"],
  grievanceOfficer: {
    name: "A. Example",
    email: "grievance@friendsofanimals.example",
  },
};

const taxFacts = {
  legalName: "Friends of Animals Foundation",
  registrationType: "Section 8 company",
  registrationNumber: "U00000KA2026NPL000000",
  pan: "AAAAA0000A",
};

describe("mergeOrgFacts", () => {
  it("joins the settings' tax facts and the site facts document", () => {
    expect(mergeOrgFacts(taxFacts, siteFacts)).toEqual({
      legalName: "Friends of Animals Foundation",
      email: "hello@friendsofanimals.example",
      phone: "+91 80 1234 5678",
      address: "12 Example Road, Bengaluru 560001",
      registration: {
        type: "Section 8 company",
        number: "U00000KA2026NPL000000",
        pan: "AAAAA0000A",
      },
      grievanceOfficer: {
        name: "A. Example",
        email: "grievance@friendsofanimals.example",
      },
      socials: ["https://www.instagram.com/example"],
    });
  });

  it("shows every empty fact as a placeholder, as before", () => {
    const facts = mergeOrgFacts(EMPTY_TAX_FACTS, factsKind.seedBody());
    expect(facts.legalName).toEqual(placeholder("legalName"));
    expect(facts.registration.pan).toEqual(placeholder("pan"));
    expect(facts.grievanceOfficer.email).toEqual(
      placeholder("grievanceOfficerEmail")
    );
    expect(facts.socials).toEqual(placeholder("socials"));
  });

  it("treats a blank setting as empty", () => {
    const facts = mergeOrgFacts({ ...taxFacts, pan: "   " }, siteFacts);
    expect(facts.registration.pan).toEqual(placeholder("pan"));
  });
});

describe("missingOrgFacts", () => {
  it("lists nothing once every fact is in", () => {
    expect(missingOrgFacts(mergeOrgFacts(taxFacts, siteFacts))).toEqual([]);
  });

  it("names each missing fact by its placeholder key", () => {
    expect(
      missingOrgFacts(
        mergeOrgFacts(
          { ...taxFacts, registrationNumber: "" },
          { ...siteFacts, phone: "", socials: [] }
        )
      )
    ).toEqual(["phone", "registrationNumber", "socials"]);
  });

  it("lists all ten while nothing is confirmed", () => {
    expect(
      missingOrgFacts(mergeOrgFacts(EMPTY_TAX_FACTS, factsKind.seedBody()))
    ).toEqual([
      "legalName",
      "email",
      "phone",
      "address",
      "registrationType",
      "registrationNumber",
      "pan",
      "grievanceOfficerName",
      "grievanceOfficerEmail",
      "socials",
    ]);
  });
});

describe("legalFactValue", () => {
  it("finds the fact a policy page refers to", () => {
    const facts = mergeOrgFacts(taxFacts, siteFacts);
    expect(legalFactValue(facts, "legalName")).toBe(taxFacts.legalName);
    expect(legalFactValue(facts, "grievanceOfficerEmail")).toBe(
      siteFacts.grievanceOfficer.email
    );
  });
});
