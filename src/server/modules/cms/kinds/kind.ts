// What the CMS needs from each kind of document (#111): how to check a
// submitted body, how to make any stored value safe to render, and the
// body a document starts with in the seed. One file per kind next to
// this one; ./index.ts lists them.
//
// Loads under plain Node (seed): relative imports only.

import type { CmsDocumentKey } from "../domain/documents";

export type ParsedCmsBody<Body> =
  | { ok: true; body: Body }
  | { ok: false; issues: string[] };

export type CmsKind<Body> = {
  /**
   * Sanitises `value`, then checks it is a complete body of this kind:
   * what saving a draft stores, or the issues that refuse it.
   */
  parse(value: unknown): ParsedCmsBody<Body>;
  /**
   * The safe part of any value, never throwing: what rendering a stored
   * revision shows, however it got into the database.
   */
  sanitize(value: unknown): Body;
  /** The body `key` starts with in the preview seed: the repo's copy. */
  seedBody(key: CmsDocumentKey): Body;
};
