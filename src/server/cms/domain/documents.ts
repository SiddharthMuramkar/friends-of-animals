// The documents the CMS edits (#111), what kind each is and how publishing
// one refreshes the public pages. Each document has one cache tag; the
// public read caches under it and publishing calls `updateTag` on it, so a
// published change shows on the next request without a deploy. Site facts
// also feed the footer, contact details and JSON-LD through one shared
// facts read, which has a tag of its own.
//
// The kinds' body schemas live in one file per kind next to this one.
// Later CMS tickets (blog #112, events #125) add their own documents.
//
// Loads under plain Node (schema, seed): relative imports only.

import type { LegalDocId } from "../../../content/legal";

export const CMS_DOCUMENT_KINDS = [
  "home",
  "page",
  "impact",
  "facts",
  "legal",
] as const;

export type CmsDocumentKind = (typeof CMS_DOCUMENT_KINDS)[number];

type DocumentSpec =
  | { kind: Exclude<CmsDocumentKind, "legal"> }
  | { kind: "legal"; legalDoc: LegalDocId };

const DOCUMENTS = {
  home: { kind: "home" },
  about: { kind: "page" },
  impact: { kind: "impact" },
  site_facts: { kind: "facts" },
  legal_privacy: { kind: "legal", legalDoc: "privacy" },
  legal_terms: { kind: "legal", legalDoc: "terms" },
  legal_safeguarding: { kind: "legal", legalDoc: "safeguarding" },
  legal_child_protection: { kind: "legal", legalDoc: "childProtection" },
} as const satisfies Record<string, DocumentSpec>;

export type CmsDocumentKey = keyof typeof DOCUMENTS;

export const CMS_DOCUMENT_KEYS = Object.keys(DOCUMENTS) as CmsDocumentKey[];

export function isCmsDocumentKey(value: string): value is CmsDocumentKey {
  return Object.hasOwn(DOCUMENTS, value);
}

export function cmsDocumentKind(key: CmsDocumentKey): CmsDocumentKind {
  return DOCUMENTS[key].kind;
}

/** The policy page a legal document is. */
export function legalDocOf(key: CmsDocumentKey): LegalDocId {
  const spec: DocumentSpec = DOCUMENTS[key];
  if (spec.kind !== "legal") throw new Error(`${key} is not a legal document`);
  return spec.legalDoc;
}

/** The CMS document behind a policy page. */
export function legalDocumentKey(legalDoc: LegalDocId): CmsDocumentKey {
  const key = CMS_DOCUMENT_KEYS.find((candidate) => {
    const spec: DocumentSpec = DOCUMENTS[candidate];
    return spec.kind === "legal" && spec.legalDoc === legalDoc;
  });
  if (!key) throw new Error(`No CMS document for the ${legalDoc} page`);
  return key;
}

/**
 * The policy page each consent purpose (#64) rests on. A consent document
 * records the published revision of this page when it is published, and
 * the consent screens link to the page's current version.
 */
const CONSENT_PURPOSE_PAGE = {
  privacy_notice: "legal_privacy",
  terms: "legal_terms",
  messages: "legal_privacy",
} as const satisfies Record<string, CmsDocumentKey>;

export type LinkedConsentPurpose = keyof typeof CONSENT_PURPOSE_PAGE;

export function legalKeyForConsentPurpose(
  purpose: LinkedConsentPurpose
): CmsDocumentKey {
  return CONSENT_PURPOSE_PAGE[purpose];
}

/** The tag a document's public read caches under. */
export function cmsTag(key: CmsDocumentKey): string {
  return `cms:${key}`;
}

/** The tag of the shared organisation-facts read (settings + site facts). */
export const ORG_FACTS_TAG = "org-facts";

/** Every tag to refresh when `key` is published. */
export function tagsToRefresh(key: CmsDocumentKey): string[] {
  return key === "site_facts" ? [cmsTag(key), ORG_FACTS_TAG] : [cmsTag(key)];
}
