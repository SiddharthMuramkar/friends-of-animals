// Entity tags as R2 and B2 report them. The copy-bucket adapters hand out
// normalised etags, so comparing two is a plain equality.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

/** Without quotes or a weak marker, lower-cased. */
export function normaliseEtag(raw: string): string {
  const etag = raw
    .trim()
    .replace(/^W\//i, "")
    .replace(/^"(.*)"$/, "$1")
    .toLowerCase();
  if (etag === "") throw new Error("An object's etag is empty");
  return etag;
}
