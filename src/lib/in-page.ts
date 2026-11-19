/**
 * Pure helpers for in-page jumps (InPageLink, SkipLink) and for keeping a
 * focused element clear of a sticky bar. The DOM work lives in the client
 * components; these stay testable in node.
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

/**
 * How far to scroll (negative = up) so an element whose top is at `top`
 * (viewport px) sits `gap` px below a sticky bar ending at `barBottom`.
 * 0 when the element already starts below the bar.
 */
export function scrollToClear(
  top: number,
  barBottom: number,
  gap: number
): number {
  return top < barBottom ? top - barBottom - gap : 0;
}
