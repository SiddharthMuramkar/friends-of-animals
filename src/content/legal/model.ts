/**
 * Legal and policy documents as typed blocks: a plain-language "short
 * version" first, then the full text in sections.
 * Organisation facts are references into getOrgFacts(), rendered as
 * visible placeholders until FOA confirms them; never typed in by hand.
 */

export const LEGAL_FACTS = [
  "legalName",
  "email",
  "phone",
  "address",
  "grievanceOfficerName",
  "grievanceOfficerEmail",
] as const;
export type LegalFact = (typeof LEGAL_FACTS)[number];

export type LegalInline =
  | string
  | { strong: string }
  | { link: string; href: string }
  | { fact: LegalFact };

export type LegalBlock = { p: LegalInline[] } | { list: LegalInline[][] };

export type LegalSection = {
  /** Anchor id, kebab-case and unique within the document. */
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDoc = {
  /** Fixed ISO date shown as "Last updated", so prerendering never reads the clock. */
  updated: string;
  /** "The short version": plain words, child-friendly where children read it. */
  short: LegalInline[][];
  sections: LegalSection[];
};

/** The date every policy was last changed (one date while they launch together). */
export const POLICIES_UPDATED = "2026-11-18";
