// Inbox items may carry a link to the page they are about. Links come from
// code, never from staff or users, but the inbox renders them as hrefs, so
// the dispatcher keeps only paths on this site: no other origins (including
// protocol-relative `//host` and the `/\host` form browsers treat the same
// way), no `javascript:` or `data:` links, no whitespace or control
// characters.
//
// Pure: no imports.

/** Longest link an inbox item stores. */
export const INBOX_LINK_MAX_LENGTH = 500;

/** Printable ASCII without space or backslash, after one leading slash. */
const SAFE_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;

/** True when `link` is a path on this site that an inbox item may carry. */
export function isInboxLink(link: string): boolean {
  return link.length <= INBOX_LINK_MAX_LENGTH && SAFE_PATH.test(link);
}
