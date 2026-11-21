// The kinds of CMS document, one line each (#111). A document whose kind
// has no line yet is listed but can't be edited. 111b adds home, page,
// impact and facts.
//
// Loads under plain Node (seed): relative imports only.

import {
  cmsDocumentKind,
  type CmsDocumentKey,
  type CmsDocumentKind,
} from "../domain/documents";
import type { CmsKind } from "./kind";
import { legalKind } from "./legal";

export type { CmsKind, ParsedCmsBody } from "./kind";

const KINDS: Partial<Record<CmsDocumentKind, CmsKind<unknown>>> = {
  legal: legalKind,
};

/** The kind behind `key`, or null while its kind isn't built. */
export function kindOf(key: CmsDocumentKey): CmsKind<unknown> | null {
  return KINDS[cmsDocumentKind(key)] ?? null;
}
