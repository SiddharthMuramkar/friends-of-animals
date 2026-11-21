// The legal kind (#111): the four policy pages. A body is the policy-page
// block shape (the short version, then titled sections of paragraphs and
// lists), the same shape #64's consent documents store, because
// publishing the privacy or terms page mirrors its body into the next
// consent document. So a legal body must pass both the one sanitiser and
// the consent document's own check.
//
// Loads under plain Node (seed): relative imports only.

import { LEGAL_DOCS } from "../../../../content/legal";
import {
  parseConsentDocumentBody,
  type ConsentDocumentBody,
} from "../../../consent/domain/document-body";
import { sanitizeDocumentBody } from "../../../rich-text/blocks";
import { legalDocOf } from "../domain/documents";
import type { CmsKind } from "./kind";

export type LegalBody = ConsentDocumentBody;

export const legalKind: CmsKind<LegalBody> = {
  parse(value) {
    return parseConsentDocumentBody(legalKind.sanitize(value));
  },
  sanitize(value) {
    return sanitizeDocumentBody(value, "cms");
  },
  seedBody(key) {
    const { short, sections } = LEGAL_DOCS[legalDocOf(key)];
    return { short, sections };
  },
};
