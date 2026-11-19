import { childProtection } from "./child-protection";
import { privacy } from "./privacy";
import { safeguarding } from "./safeguarding";
import { terms } from "./terms";

export type {
  LegalBlock,
  LegalDoc,
  LegalFact,
  LegalInline,
  LegalSection,
} from "./model";
export { LEGAL_FACTS, POLICIES_UPDATED } from "./model";

/** The four policy pages, keyed like the routes registry. */
export const LEGAL_DOCS = {
  privacy,
  terms,
  safeguarding,
  childProtection,
} as const;
export type LegalDocId = keyof typeof LEGAL_DOCS;
