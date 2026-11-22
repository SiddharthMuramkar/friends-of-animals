/**
 * The template key in the editor's path. Next decodes a route param once
 * already; this decodes what's left, and keeps a malformed escape such as
 * `%` as it is, so the lookup reports "not found" instead of the page
 * throwing a URIError.
 */
export function templateKeyOf(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
