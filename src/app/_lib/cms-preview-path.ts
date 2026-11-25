// Where leaving a draft preview goes: back to the public page that was
// being previewed, never to an address the form was given.

import { CMS_DOCUMENT_KEYS } from "@/server/modules/cms/domain/documents";
import { cmsPublicPath } from "@/server/modules/cms/domain/public-paths";

const PREVIEW_PATHS: ReadonlySet<string> = new Set(
  CMS_DOCUMENT_KEYS.map(cmsPublicPath)
);

/** `raw` if it is the public page of a CMS document; else the home page. */
export function previewExitPath(raw: string | null): `/${string}` {
  return raw !== null && PREVIEW_PATHS.has(raw) ? (raw as `/${string}`) : "/";
}
