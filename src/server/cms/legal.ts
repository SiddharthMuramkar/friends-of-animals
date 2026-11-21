// The legal pages in the CMS (#111): their current version, and the
// consent documents that rest on them.
//
//   currentLegalVersion({ key })  → anyone
//
// Loads under plain Node: relative imports only.

import type { CmsDocumentKey } from "./domain/documents";
import type { CmsContext } from "./publishing";

export type LegalVersion = { version: number; publishedAt: Date };

export async function currentLegalVersion(
  _ctx: CmsContext,
  _input: { key: CmsDocumentKey }
): Promise<LegalVersion | null> {
  throw new Error("currentLegalVersion is not built yet");
}
