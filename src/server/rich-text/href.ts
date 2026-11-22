// Where a link in rich text may point. An allowlist, not a blocklist: a
// page on this site, an anchor on the page, an https address, an email
// address or a phone number. Everything else (javascript:, data:, http:,
// protocol-relative "//host", "/\host", entity-encoded schemes, and
// look-alike hosts with a user part, "https://friendsofanimals.org@evil.test")
// is refused.
//
// Loads under plain Node (schema, seed): relative imports only.

import { isInvisibleControl } from "./strip-markup";

const MAX_HREF_LENGTH = 2048;

/** Whitespace, quotes, angle brackets, backslashes and backticks. */
const UNSAFE_CHARACTER = /[\s"'<>\\`]/;

function hasUnsafeCharacter(href: string): boolean {
  if (UNSAFE_CHARACTER.test(href)) return true;
  for (const char of href) {
    if (isInvisibleControl(char.codePointAt(0)!)) return true;
  }
  return false;
}

const ALLOWED = [
  // A path on this site: "/" not followed by a second "/".
  /^\/(?!\/)/,
  // An anchor on this page, kebab-case like the policy pages' ids.
  /^#[a-z0-9]+(?:-[a-z0-9]+)*$/,
  // Another site, over https, with a host and no user part.
  /^https:\/\/[^/?#@]+(?:[/?#]|$)/,
  /^mailto:[^@/?#]+@[^@/?#]+\.[^@/?#]+$/,
  /^tel:\+?[0-9][0-9-]*$/,
];

/** The link, trimmed, if it may appear in rich text; otherwise `null`. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.length === 0 || href.length > MAX_HREF_LENGTH) return null;
  if (hasUnsafeCharacter(href)) return null;
  return ALLOWED.some((pattern) => pattern.test(href)) ? href : null;
}

/**
 * The `rel` for a link that passed `safeHref`: links to other sites can't
 * reach back through `window.opener`, send a referrer or pass search rank.
 */
export function linkRel(href: string): string | undefined {
  return href.startsWith("https://")
    ? "noopener noreferrer nofollow"
    : undefined;
}
