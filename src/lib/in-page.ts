/**
 * Pure helpers for in-page jumps (InPageLink, SkipLink). The DOM work lives
 * in the client components; these stay testable in node.
 */

/** The element id an in-page href points at ("#who-we-are"), or null. */
export function hashTarget(href: string): string | null {
  if (!href.startsWith("#") || href.length < 2) return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

/** A click the browser should handle itself (new tab, new window, …). */
export function isModifiedClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}
