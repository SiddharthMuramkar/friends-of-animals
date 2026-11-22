// Entity tags as R2 and B2 report them. A single-part upload's etag is the
// hex MD5 of its bytes; a multipart upload's is `<hex>-<parts>` and isn't.
// The manifest stores normalised etags, so a change is a plain inequality.

import { normaliseEtag } from "../../../ports/etag";

const SINGLE_PART = /^[0-9a-f]{32}$/;

/**
 * The base64 `Content-MD5` header for an object with this etag, so B2
 * refuses a copy whose bytes arrived damaged. Null for a multipart etag:
 * then the copy goes without the check.
 */
export function contentMd5ForEtag(etag: string): string | null {
  const hex = normaliseEtag(etag);
  if (!SINGLE_PART.test(hex)) return null;
  return Buffer.from(hex, "hex").toString("base64");
}
