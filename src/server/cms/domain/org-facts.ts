// FOA's organisation facts (#111), in the shape the pages have always read
// them: each one a value, or a placeholder while FOA hasn't confirmed it.
// Two owners feed them. Tax and registration facts are runtime settings (a
// super admin, with step-up): they drive receipts. Contact and grievance
// facts are the `site_facts` CMS document (a content manager). One read
// merges both, so the footer, contact details, policy pages and JSON-LD
// never disagree.
//
// Competition fees are not here: they stay in code until the competition
// module owns them.
//
// Loads under plain Node (seed): relative imports only.

import type { LegalFact } from "../../../content/legal/model";
import {
  type OrgFact,
  placeholder,
  isPlaceholder,
  type PlaceholderKey,
} from "../../../lib/site";
import { factsKind, type SiteFactsBody } from "../kinds/facts";

export type OrgFacts = {
  legalName: OrgFact;
  email: OrgFact;
  phone: OrgFact;
  address: OrgFact;
  registration: { type: OrgFact; number: OrgFact; pan: OrgFact };
  grievanceOfficer: { name: OrgFact; email: OrgFact };
  /** Profile URLs. */
  socials: OrgFact<readonly string[]>;
};

/** The facts held in settings; an empty string is "not confirmed". */
export type TaxFacts = {
  legalName: string;
  registrationType: string;
  registrationNumber: string;
  pan: string;
};

export const EMPTY_TAX_FACTS: TaxFacts = {
  legalName: "",
  registrationType: "",
  registrationNumber: "",
  pan: "",
};

function fact(value: string, key: PlaceholderKey): OrgFact {
  const trimmed = value.trim();
  return trimmed ? trimmed : placeholder(key);
}

export function mergeOrgFacts(tax: TaxFacts, site: SiteFactsBody): OrgFacts {
  return {
    legalName: fact(tax.legalName, "legalName"),
    email: fact(site.email, "email"),
    phone: fact(site.phone, "phone"),
    address: fact(site.address, "address"),
    registration: {
      type: fact(tax.registrationType, "registrationType"),
      number: fact(tax.registrationNumber, "registrationNumber"),
      pan: fact(tax.pan, "pan"),
    },
    grievanceOfficer: {
      name: fact(site.grievanceOfficer.name, "grievanceOfficerName"),
      email: fact(site.grievanceOfficer.email, "grievanceOfficerEmail"),
    },
    socials: site.socials.length > 0 ? site.socials : placeholder("socials"),
  };
}

/** Every fact still to be confirmed: before FOA enters any, or with no database. */
export function unconfirmedOrgFacts(): OrgFacts {
  return mergeOrgFacts(EMPTY_TAX_FACTS, factsKind.seedBody());
}

/** The facts still to be confirmed, by placeholder key, in page order. */
export function missingOrgFacts(facts: OrgFacts): PlaceholderKey[] {
  const values: unknown[] = [
    facts.legalName,
    facts.email,
    facts.phone,
    facts.address,
    facts.registration.type,
    facts.registration.number,
    facts.registration.pan,
    facts.grievanceOfficer.name,
    facts.grievanceOfficer.email,
    facts.socials,
  ];
  return values.filter(isPlaceholder).map((value) => value.key);
}

/** The fact a policy page's `{ fact }` reference shows. */
export function legalFactValue(facts: OrgFacts, legalFact: LegalFact): OrgFact {
  switch (legalFact) {
    case "legalName":
      return facts.legalName;
    case "email":
      return facts.email;
    case "phone":
      return facts.phone;
    case "address":
      return facts.address;
    case "grievanceOfficerName":
      return facts.grievanceOfficer.name;
    case "grievanceOfficerEmail":
      return facts.grievanceOfficer.email;
  }
}
