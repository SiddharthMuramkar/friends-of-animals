import { z } from "zod";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";

import { type ArticleBody, articleBodySchema } from "./model";

export type { ArticleBody, Block, Footnote, Inline } from "./model";

/**
 * The cited articles (DIRECTION §7; briefs in research/stories.md §4 and
 * quotes.md Q10). Metadata lives here; each body is its own module in
 * ./articles/<slug>.ts, loaded on demand.
 */

export const STORY_SLUGS = [
  "rukmini-devi-and-indias-animal-law",
  "a-drawing-that-feeds-tiny-guests",
  "the-stork-that-gets-a-baby-shower",
  "two-pilots-two-puppies",
  "kinder-skies-in-kite-season",
] as const;
export type StorySlug = (typeof STORY_SLUGS)[number];

export const AUDIENCES = ["kids", "families", "everyone"] as const;
export type Audience = (typeof AUDIENCES)[number];

const storySchema = z.strictObject({
  slug: z.enum(STORY_SLUGS),
  title: z.string().min(1).max(80),
  /** The excerpt (SPEC §9.4.1: ≤ 300 characters). */
  dek: z.string().min(1).max(300),
  /** One or two short sentences at grade 6 or below: the "Easy read" layer. */
  easyRead: z.string().min(1).max(200),
  audience: z.enum(AUDIENCES),
  /** Absent: the card shows a tile-pattern cover (no licensed photo exists). */
  coverImageId: z.enum(SITE_IMAGE_IDS).optional(),
  topics: z.array(z.string().regex(/^[a-z-]+$/)).min(1),
  readingMinutes: z.int().min(1).max(30),
  /** Fixed, so prerendering never reads the clock. */
  publishedOn: z.iso.date(),
  featured: z.boolean(),
});
export type Story = z.infer<typeof storySchema>;

export const STORIES: readonly Story[] = z
  .array(storySchema)
  .length(STORY_SLUGS.length)
  .parse([
    {
      slug: "rukmini-devi-and-indias-animal-law",
      title: "The dancer who shaped India’s animal law",
      dek: "Rukmini Devi Arundale, a dancer and the first woman nominated to the Rajya Sabha, asked Parliament in 1954 to protect animals from cruelty. India’s 1960 animal-welfare law followed.",
      easyRead:
        "A dancer named Rukmini Devi asked India’s Parliament to protect animals. Her work helped make a law in 1960. It still keeps animals safe.",
      audience: "everyone",
      topics: ["history", "law"],
      readingMinutes: 4,
      publishedOn: "2026-11-18",
      featured: true,
    },
    {
      slug: "a-drawing-that-feeds-tiny-guests",
      title: "A drawing that feeds a thousand tiny guests",
      dek: "Each morning, rice-flour patterns appear at doorsteps in Tamil Nadu. By evening, feet, ants and birds have carried them away. Sharing is part of the idea.",
      easyRead:
        "Every morning, people in Tamil Nadu draw at the door with rice flour. Ants and birds eat the flour. The art is also a gift.",
      audience: "kids",
      coverImageId: "care-kolam-rice",
      topics: ["traditions", "art"],
      readingMinutes: 4,
      publishedOn: "2026-11-18",
      featured: false,
    },
    {
      slug: "the-stork-that-gets-a-baby-shower",
      title: "The stork that gets a baby shower",
      dek: "In Assam, a giant stork was once called a bad omen. Now thousands of women guard its nests, sing about it and hold baby showers for its chicks.",
      easyRead:
        "A giant stork in Assam was called bad luck. Now women sing for it, guard its nests and throw parties for its chicks.",
      audience: "kids",
      topics: ["birds", "community"],
      readingMinutes: 5,
      publishedOn: "2026-11-18",
      featured: false,
    },
    {
      slug: "two-pilots-two-puppies",
      title: "Two pilots, two puppies and the start of Blue Cross",
      dek: "On a rainy day in 1959, a Madras pilot took two puppies home from a flooded road. His family’s house soon held sixty animals. Blue Cross had begun.",
      easyRead:
        "In 1959, a pilot took two puppies home from a flood. Soon his family cared for 60 animals. That was the start of Blue Cross.",
      audience: "families",
      coverImageId: "puppies-lounging-cloth",
      topics: ["rescue", "history"],
      readingMinutes: 4,
      publishedOn: "2026-11-18",
      featured: false,
    },
    {
      slug: "kinder-skies-in-kite-season",
      title: "Kinder skies in kite season",
      dek: "In January 2026, Gujarat ran over 1,000 bird-care points for kite season. In Delhi, a bird hospital open since 1929 treats its patients free.",
      easyRead:
        "Kites are fun, but string can hurt birds. Use cotton thread, fly in the day, and tell a grown-up if a bird is stuck.",
      audience: "families",
      coverImageId: "se-kites-uttarayan",
      topics: ["festivals", "birds"],
      readingMinutes: 4,
      publishedOn: "2026-11-18",
      featured: false,
    },
  ]);

const bySlug = new Map(STORIES.map((s) => [s.slug, s]));

export function isStorySlug(slug: string): slug is StorySlug {
  return bySlug.has(slug as StorySlug);
}

export function getStory(slug: StorySlug): Story {
  return bySlug.get(slug)!;
}

/** SPEC §9.4.3: featured first, then newest; ties keep registry order. */
export function latestStories(limit = 3): Story[] {
  return STORIES.toSorted(
    (a, b) =>
      Number(b.featured) - Number(a.featured) ||
      b.publishedOn.localeCompare(a.publishedOn)
  ).slice(0, limit);
}

const BODIES: Record<StorySlug, () => Promise<{ article: unknown }>> = {
  "rukmini-devi-and-indias-animal-law": () =>
    import("./articles/rukmini-devi-and-indias-animal-law"),
  "a-drawing-that-feeds-tiny-guests": () =>
    import("./articles/a-drawing-that-feeds-tiny-guests"),
  "the-stork-that-gets-a-baby-shower": () =>
    import("./articles/the-stork-that-gets-a-baby-shower"),
  "two-pilots-two-puppies": () => import("./articles/two-pilots-two-puppies"),
  "kinder-skies-in-kite-season": () =>
    import("./articles/kinder-skies-in-kite-season"),
};

/** The article body, validated (unknown blocks or dangling footnotes throw). */
export async function loadArticle(slug: StorySlug): Promise<ArticleBody> {
  const { article } = await BODIES[slug]();
  return articleBodySchema.parse(article);
}
