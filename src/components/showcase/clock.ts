import { cacheLife } from "next/cache";

/**
 * "Now" for server components, refreshed daily. Reading the clock while
 * prerendering needs a cache boundary under Cache Components (as in
 * site-footer.tsx).
 */
export async function cachedNow(): Promise<number> {
  "use cache";
  cacheLife("days");
  return Date.now();
}
