import { childProtection } from "./child-protection";
import { privacy } from "./privacy";
import { safeguarding } from "./safeguarding";
import { terms } from "./terms";

export type {
  LegalBlock,
  LegalClause,
  LegalDoc,
  LegalFact,
  LegalInline,
  LegalSection,
  ShownInline,
} from "./model";
export { LEGAL_FACTS, POLICIES_UPDATED } from "./model";
export { resolveLegalDoc } from "./resolve";

/** The four policy pages, keyed like the routes registry. */
export const LEGAL_DOCS = {
  privacy,
  terms,
  safeguarding,
  childProtection,
} as const;
export type LegalDocId = keyof typeof LEGAL_DOCS;
