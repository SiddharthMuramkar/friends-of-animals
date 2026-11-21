import { homeCompetitions } from "@/content/sample/selectors";
import type { Competition } from "@/content/sample/model";
import type { HomeBody, HomeSectionKey } from "@/server/cms/kinds/home";

/**
 * The home page's layout is the `home` CMS document: the hero's text and
 * buttons, its four counters and which sections show, in order.
 */
export type HomeLayout = HomeBody;
export type { HomeSectionKey };

export function visibleSections(layout: HomeLayout): HomeSectionKey[] {
  return layout.sections.filter((s) => s.visible).map((s) => s.key);
}

export type Announcement = { name: string; slug: string; expiresAt: string };

/** The open competition that closes soonest, as an announcement bar. */
export function openAnnouncement(
  list: readonly Competition[]
): Announcement | null {
  const open = homeCompetitions(list).find(
    (c) => c.status === "REGISTRATION_OPEN"
  );
  return open
    ? { name: open.name, slug: open.slug, expiresAt: open.registrationClosesAt }
    : null;
}

/** Hidden from `expiresAt` on. */
export function activeAnnouncement(
  a: Announcement | null,
  now: number
): Announcement | null {
  return a && now < Date.parse(a.expiresAt) ? a : null;
}
