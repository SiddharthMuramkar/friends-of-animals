// The home page as a CMS document (#111): the hero's words, picture and
// buttons, which four counters it shows, and which sections appear in what
// order. The sections themselves (competition cards, stories, the gallery)
// stay in code; a content manager only turns them on or off and orders them.
//
// Every text field is plain text: markup is stripped on save and again on
// render. Buttons go to public pages only, picked from the route table;
// pictures come from the site's credited image set.
//
// Loads under plain Node (seed): relative imports only.

import { z } from "zod";

import { COUNTER_KEYS } from "../../../content/sample/model";
import { SITE_IMAGE_IDS } from "../../../lib/images/credits";
import { ROUTES } from "../../../lib/routes";
import { defineKind, plainText, uniqueKeys } from "./fields";

export const HOME_SECTION_KEYS = [
  "competitions",
  "howItWorks",
  "whyChildren",
  "gallery",
  "impact",
  "stories",
  "seasonal",
  "badges",
  "donate",
  "joy",
  "events",
] as const;

export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

/** Public pages a hero button may open: no slugs, no test-only pages. */
export const CTA_PATHS = Object.values(ROUTES)
  .filter((route) => !("nonProduction" in route) && !route.path.includes("["))
  .map((route) => route.path);

const ctaSchema = z.strictObject({
  label: plainText(40),
  href: z.enum(CTA_PATHS as [string, ...string[]], {
    error: "pick one of the site's public pages",
  }),
});

const counterKeysSchema = z
  .tuple([
    z.enum(COUNTER_KEYS),
    z.enum(COUNTER_KEYS),
    z.enum(COUNTER_KEYS),
    z.enum(COUNTER_KEYS),
  ])
  .refine((keys) => new Set(keys).size === keys.length, {
    error: "pick four different counters",
  });

const sectionsSchema = z
  .array(
    z.strictObject({ key: z.enum(HOME_SECTION_KEYS), visible: z.boolean() })
  )
  .superRefine((sections, ctx) => {
    const listed = sections.map((s) => s.key);
    uniqueKeys(listed, ctx);
    for (const key of HOME_SECTION_KEYS) {
      if (!listed.includes(key)) {
        ctx.addIssue({ code: "custom", message: `${key} is missing` });
      }
    }
  });

const homeBodySchema = z.strictObject({
  hero: z.strictObject({
    eyebrow: plainText(80),
    heading: plainText(120),
    subheading: plainText(400),
    imageAssetId: z.enum(SITE_IMAGE_IDS),
    /** Under the picture; empty for none. */
    caption: plainText(120, { allowEmpty: true }),
    /** The handwritten note pinned to the picture; empty for none. */
    note: plainText(40, { allowEmpty: true }),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema.optional(),
  }),
  counterKeys: counterKeysSchema,
  sections: sectionsSchema,
});

export type HomeBody = z.output<typeof homeBodySchema>;

/** Today's home page, as the first published revision. */
const HOME_SEED: HomeBody = {
  hero: {
    eyebrow: "An Indian non-profit for children and animals",
    heading: "Children’s art that grows kindness to animals",
    subheading:
      "Friends of Animals runs drawing, painting, craft, writing, photography and film competitions for children and young adults. Every one is about animals and how to treat them well, and every entry earns a certificate.",
    imageAssetId: "dog-bengaluru-auto-rickshaw",
    caption: "A street dog takes a seat in an auto-rickshaw.",
    note: "This seat is taken",
    primaryCta: {
      label: "See the competitions",
      href: ROUTES.competitions.path,
    },
    secondaryCta: {
      label: "Bring FOA to your school",
      href: ROUTES.schools.path,
    },
  },
  counterKeys: [
    "participants",
    "institutions",
    "statesReached",
    "competitions",
  ],
  sections: HOME_SECTION_KEYS.map((key) => ({
    key,
    // Needs the events module, not built yet.
    visible: key !== "events",
  })),
};

export const homeKind = defineKind(homeBodySchema, HOME_SEED);
