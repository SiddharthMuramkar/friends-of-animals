import { homeCompetitions } from "@/content/sample/selectors";
import type { Competition, CounterKey } from "@/content/sample/model";
import type { SiteImageId } from "@/lib/images";
import { ROUTES } from "@/lib/routes";

/**
 * The home page's layout in the shape of a `homeLayout` block, so the CMS
 * can supply it later. Text fields hold message keys under `home.`
 * until then.
 */
export type HomeSectionKey =
  | "competitions"
  | "howItWorks"
  | "whyChildren"
  | "gallery"
  | "impact"
  | "stories"
  | "seasonal"
  | "badges"
  | "donate"
  | "joy"
  | "events";

/** Message keys under `home`. */
type HeroKey =
  | "hero.heading"
  | "hero.subheading"
  | "hero.primary"
  | "hero.secondary";
type Cta = { label: HeroKey; href: string };

export type HomeLayout = {
  hero: {
    heading: HeroKey;
    subheading: HeroKey;
    imageAssetId: SiteImageId;
    alt?: string;
    primaryCta: Cta;
    secondaryCta?: Cta;
  };
  counterKeys: readonly [CounterKey, CounterKey, CounterKey, CounterKey];
  sections: readonly { key: HomeSectionKey; visible: boolean }[];
};

export const HOME_LAYOUT: HomeLayout = {
  hero: {
    heading: "hero.heading",
    subheading: "hero.subheading",
    imageAssetId: "dog-bengaluru-auto-rickshaw",
    primaryCta: { label: "hero.primary", href: ROUTES.competitions.path },
    secondaryCta: { label: "hero.secondary", href: ROUTES.schools.path },
  },
  counterKeys: [
    "participants",
    "institutions",
    "statesReached",
    "competitions",
  ],
  sections: [
    { key: "competitions", visible: true },
    { key: "howItWorks", visible: true },
    { key: "whyChildren", visible: true },
    { key: "gallery", visible: true },
    { key: "impact", visible: true },
    { key: "stories", visible: true },
    { key: "seasonal", visible: true },
    { key: "badges", visible: true },
    { key: "donate", visible: true },
    { key: "joy", visible: true },
    // Needs the events module, not built yet.
    { key: "events", visible: false },
  ],
};

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
