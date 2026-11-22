/**
 * Legal and policy documents as typed blocks: a plain-language "short
 * version" first, then the full text in sections.
 * Organisation facts are references into getOrgFacts(), rendered as
 * visible placeholders until FOA confirms them; never typed in by hand.
 * Production leaves them out, so each sits in a clause (resolveLegalDoc).
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
  | { fact: LegalFact }
  | LegalClause;

/**
 * Words that only hold with their facts: the facts written in `clause`
 * (not in a clause nested in it), plus any it relies on without showing
 * (`needs`). Outside production a clause always renders, with tiles for
 * unconfirmed facts. In production, unless all its facts are confirmed,
 * `otherwise` renders in its place, or nothing.
 */
export type LegalClause = {
  clause: LegalInline[];
  needs?: LegalFact[];
  otherwise?: LegalInline[];
};

/** Text as a page shows it, once resolveLegalDoc has settled each clause. */
export type ShownInline = Exclude<LegalInline, LegalClause>;

export type LegalBlock<I = LegalInline> = { p: I[] } | { list: I[][] };

export type LegalSection<I = LegalInline> = {
  /** Anchor id, kebab-case and unique within the document. */
  id: string;
  title: string;
  blocks: LegalBlock<I>[];
};

export type LegalDoc<I = LegalInline> = {
  /** Fixed ISO date shown as "Last updated", so prerendering never reads the clock. */
  updated: string;
  /** "The short version": plain words, child-friendly where children read it. */
  short: I[][];
  sections: LegalSection<I>[];
};

/** The date every policy was last changed (one date while they launch together). */
export const POLICIES_UPDATED = "2026-11-18";
