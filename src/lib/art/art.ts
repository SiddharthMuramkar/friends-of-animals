import { z } from "zod";

import rawArt from "@/assets/site-art/art.json";

import { SITE_ART_IDS, type SiteArtId } from "./ids";

export { SITE_ART_IDS, type SiteArtId } from "./ids";

/**
 * FOA's AI illustrations (ADR 0003). Photos stay real and live in
 * src/lib/images; drawings live here, each labelled as an AI illustration
 * wherever it carries meaning, and credited on /credits with its provenance.
 */
export const ART_FOLDERS = [
  "living",
  "covers",
  "seasons",
  "stickers",
  "scenes",
  "doors",
  "chain",
  "waiting",
  "portraits",
  "gallery",
] as const;

export const ART_KINDS = ["sticker", "scene", "cover", "living"] as const;

export const artSchema = z
  .strictObject({
    id: z.enum(SITE_ART_IDS),
    file: z
      .string()
      .regex(new RegExp(`^(?:${ART_FOLDERS.join("|")})/[a-z0-9-]+\\.webp$`)),
    kind: z.enum(ART_KINDS),
    title: z.string().trim().min(1),
    /** Says what matters and that it is an AI illustration; null when decorative. */
    alt: z.string().trim().min(21).nullable(),
    decorative: z.boolean(),
    tool: z.literal("ElevenLabs"),
    model: z.string().min(1),
    /** The video model a living illustration's frames came from. */
    video: z.string().min(1).nullable(),
    flowId: z.string().min(1),
    generationIds: z.array(z.string().min(1)).min(1),
    /** The subject part of the prompt; the shared style, background and constraints are in the README. */
    prompt: z.string().trim().min(1),
    generatedAt: z.iso.date(),
    digitalSourceType: z.literal("trainedAlgorithmicMedia"),
    review: z.strictObject({
      method: z.literal("rubric-panel"),
      /** AI judges on the panel, each with its own lens (README, Rubric). */
      judges: z.int().min(3),
      mean: z.number().min(4).max(5),
      gatesPassed: z.literal(true),
      humanReviewer: z.string().min(1).nullable(),
    }),
    whyChosen: z.string().trim().min(1).max(160),
    width: z.int().positive(),
    height: z.int().positive(),
    /** Frames in a living illustration's strip (each width x height). */
    frames: z.int().min(2).nullable(),
    bytes: z.int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine((a) => (a.alt === null) === a.decorative, {
    message: "decorative art has no alt text; meaningful art must have it",
    path: ["alt"],
  })
  .refine((a) => a.alt === null || a.alt.startsWith("AI illustration: "), {
    message: 'alt text must start with "AI illustration: "',
    path: ["alt"],
  })
  .refine((a) => (a.kind === "living") === (a.frames !== null), {
    message: "only a living illustration has frames",
    path: ["frames"],
  })
  .refine((a) => a.file.endsWith(`/${a.id}.webp`), {
    message: "file name must be <folder>/<id>.webp",
    path: ["file"],
  });

export type Art = z.infer<typeof artSchema>;

export const artRegistrySchema = z.array(artSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  for (const a of list) {
    if (seen.has(a.id))
      ctx.addIssue({ code: "custom", message: `duplicate id ${a.id}` });
    seen.add(a.id);
  }
});

export const art: readonly Art[] = artRegistrySchema.parse(rawArt);

const byId = new Map(art.map((a) => [a.id, a]));

export function artFor(id: SiteArtId): Art {
  const entry = byId.get(id);
  if (!entry) throw new Error(`No registry entry for illustration ${id}`);
  return entry;
}
