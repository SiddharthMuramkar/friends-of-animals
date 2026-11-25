// Loads under plain Node (schema, seed): relative imports only.
//
// Kept apart from ./documents.ts, which the client bundles through
// src/lib/app-routes.ts (isSignedInPath): importing ROUTES there shipped
// the whole public route registry to every page, exceeding the JavaScript budget.

import { ROUTES } from "../../../../lib/routes";
import type { CmsDocumentKey } from "./documents";

/**
 * The public page that shows a document, where previewing its draft
 * starts. Site facts preview on the contact page, which shows them all.
 */
const PUBLIC_PATH: Record<CmsDocumentKey, `/${string}`> = {
  home: ROUTES.home.path,
  about: ROUTES.about.path,
  impact: ROUTES.impact.path,
  site_facts: ROUTES.contact.path,
  legal_privacy: ROUTES.privacy.path,
  legal_terms: ROUTES.terms.path,
  legal_safeguarding: ROUTES.safeguarding.path,
  legal_child_protection: ROUTES.childProtection.path,
};

export function cmsPublicPath(key: CmsDocumentKey): `/${string}` {
  return PUBLIC_PATH[key];
}
