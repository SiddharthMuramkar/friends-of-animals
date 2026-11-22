// The kinds of CMS document, one line each (#111). A document whose kind
// has no line yet is listed but can't be edited.
//
// Loads under plain Node (seed): relative imports only.

import {
  cmsDocumentKind,
  type CmsDocumentKey,
  type CmsDocumentKind,
} from "../domain/documents";
import { factsKind } from "./facts";
import { homeKind } from "./home";
import { impactKind } from "./impact";
import type { CmsKind } from "./kind";
import { legalKind } from "./legal";
import { pageKind } from "./page";

export type { CmsKind, ParsedCmsBody } from "./kind";

const KINDS: Partial<Record<CmsDocumentKind, CmsKind<unknown>>> = {
  legal: legalKind,
  home: homeKind,
  page: pageKind,
  impact: impactKind,
  facts: factsKind,
};

/** The kind behind `key`, or null while its kind isn't built. */
export function kindOf(key: CmsDocumentKey): CmsKind<unknown> | null {
  return KINDS[cmsDocumentKind(key)] ?? null;
}
