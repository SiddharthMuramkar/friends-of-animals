import { z } from "zod";

import rawCredits from "@/assets/site-images/credits.json";

/**
 * Every photo the public site may show. Adding an id here without a master in
 * src/assets/site-images/ and an entry in credits.json fails the tests.
 */
export const SITE_IMAGE_IDS = [
  // pages
  "dog-bengaluru-auto-rickshaw",
  "dogs-pariah-yelahanka-park",
  "cat-lentils-west-bengal",
  "art-supplies-flatlay-blue",
  "classroom-chennai-smart-class",
  "dog-vest-blanket-delhi",
  "dog-andaman-beach-sunset",
  "dogs-vests-mat-stall",
  "dog-dehradun-gate-golden",
  "puppy-ganden-peeking",
  "hand-paw-friendship",
  // street neighbours
  "sn-dog-chirala",
  "sn-cat-horniman",
  "sn-cow-udaipur-0837",
  "sn-crow-mumbai-grill",
  "sn-myna-goregaon",
  "sn-pigeon-balcony",
  "sn-sparrow-coimbatore",
  "sn-kite-bengaluru",
  "sn-squirrel-kolkata",
  "sn-koel-figs",
  // seasons
  "se-water-junglemyna",
  "se-shade-dog-soil",
  "se-rain-dog-khar",
  "se-winter-dog-coat-curled",
  "se-kites-uttarayan",
  // stories
  "care-kolam-rice",
  "puppies-lounging-cloth",
] as const;

export type SiteImageId = (typeof SITE_IMAGE_IDS)[number];

export const licenceSchema = z.enum([
  "CC0-1.0",
  "CC-BY-2.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC-BY-SA-2.0",
  "CC-BY-SA-3.0",
  "CC-BY-SA-4.0",
  "Public-domain",
  "Unsplash",
  "Pexels",
]);

export type Licence = z.infer<typeof licenceSchema>;

export const LICENCE_URL: Record<Licence, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-2.0": "https://creativecommons.org/licenses/by/2.0/",
  "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC-BY-SA-2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "Public-domain": "https://creativecommons.org/publicdomain/mark/1.0/",
  Unsplash: "https://unsplash.com/license",
  Pexels: "https://www.pexels.com/license/",
};

/** Short licence names as written in visible credits. */
export const LICENCE_LABEL: Record<Licence, string> = {
  "CC0-1.0": "CC0 1.0",
  "CC-BY-2.0": "CC BY 2.0",
  "CC-BY-3.0": "CC BY 3.0",
  "CC-BY-4.0": "CC BY 4.0",
  "CC-BY-SA-2.0": "CC BY-SA 2.0",
  "CC-BY-SA-3.0": "CC BY-SA 3.0",
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "Public-domain": "Public domain",
  Unsplash: "Unsplash",
  Pexels: "Pexels",
};

export const creditSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    file: z
      .string()
      .regex(/^(?:pages|neighbours|seasons|stories)\/[a-z0-9-]+\.jpg$/),
    title: z.string().min(1),
    author: z.string().min(1),
    authorUrl: z.url().nullable(),
    sourceUrl: z.url(),
    licence: licenceSchema,
    licenceUrl: z.url(),
    /** What was changed, e.g. "cropped; resized; metadata removed". */
    modifications: z.string().min(1),
    retrievedAt: z.iso.date(),
    originalSha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** The real place, as verified; "India" when only the country is safe; null for a studio still life. */
    place: z.string().trim().min(1).nullable(),
    alt: z.string().trim().min(1),
    people: z.enum([
      "none",
      "adult-not-identifiable",
      "child-not-identifiable",
    ]),
    consentRef: z.string().nullable(),
    ai: z.literal(false),
    whyChosen: z.string().trim().min(1).max(160),
  })
  .refine((c) => c.licenceUrl === LICENCE_URL[c.licence], {
    message: "licenceUrl must be the canonical URL for the licence",
    path: ["licenceUrl"],
  })
  .refine((c) => c.file.endsWith(`/${c.id}.jpg`), {
    message: "file name must be <theme>/<id>.jpg",
    path: ["file"],
  });

export type Credit = z.infer<typeof creditSchema>;

export const creditsSchema = z.array(creditSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.id))
      ctx.addIssue({ code: "custom", message: `duplicate id ${c.id}` });
    seen.add(c.id);
  }
});

export const credits: readonly Credit[] = creditsSchema.parse(rawCredits);

const byId = new Map(credits.map((c) => [c.id, c]));

export function creditFor(id: SiteImageId): Credit {
  const credit = byId.get(id);
  if (!credit) throw new Error(`No credit for image ${id}`);
  return credit;
}

/** CC BY and CC BY-SA require attribution where the image is shown. */
export function needsVisibleCredit(licence: Licence): boolean {
  return licence.startsWith("CC-BY");
}

/** "Photo: Slyronit, CC BY-SA 4.0" */
export function shortCredit({
  author,
  licence,
}: Pick<Credit, "author" | "licence">): string {
  return `Photo: ${author}, ${LICENCE_LABEL[licence]}`;
}
