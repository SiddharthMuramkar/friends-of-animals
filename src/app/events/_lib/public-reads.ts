import "server-only";
import { unstable_rethrow } from "next/navigation";
import { errorSummaryForLogs } from "@/server/errors";
import { cacheLife, cacheTag } from "next/cache";
import { as } from "@/server/app";
import { PUBLIC_READER } from "@/app/competitions/_lib/public-reader";
import { EVENT_SLUG_PATTERN } from "@/server/modules/events/domain/slug";
import {
  BUILD_SHELL_LIFE,
  FAILED_READ_SHELL_LIFE,
  isNextBuild,
} from "@/server/modules/cms/cached";

export const PLACEHOLDER_EVENT_SLUG = "__placeholder__";
export async function publicEvent(slug: string) {
  if (!EVENT_SLUG_PATTERN.test(slug)) return null;
  const result = await as(PUBLIC_READER).getPublicEvent({ slug });
  return result.ok ? result.event : null;
}
export async function publicEventSlugLookup(slug: string) {
  return !!(await publicEvent(slug));
}
export async function eventSitemapRows() {
  "use cache";
  cacheTag("events-sitemap");
  if (isNextBuild()) {
    cacheLife(BUILD_SHELL_LIFE);
    return [];
  }
  // This cache is only for discovery. Event pages and their proxy always
  // read live state; the admin action invalidates this tag on mutation.
  try {
    const result = await as(PUBLIC_READER).listPublishedEvents();
    cacheLife({ stale: 0, revalidate: 60, expire: 300 });
    return result.items.map((row) => ({ slug: row.slug }));
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Events: could not read the sitemap listing: ${errorSummaryForLogs(error)}`
    );
    cacheLife(FAILED_READ_SHELL_LIFE);
    return [];
  }
}
