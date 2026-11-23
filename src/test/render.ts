import type { ReactNode } from "react";
import { prerender } from "react-dom/static";

/**
 * Server-renders a tree to static HTML, async Server Components included
 * (React's prerender waits for them). Mock `next-intl/server` with
 * `@/test/next-intl-server` and `next/image` with `@/test/next-image`
 * first: both need the Next.js runtime.
 */
export async function renderHtml(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

/** The text a visitor reads: tags and React's text separators removed. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]!)
    .replace(/\s+/g, " ")
    .trim();
}
