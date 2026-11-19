import { z } from "zod";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";

import { QUOTE_IDS } from "../quotes";

/**
 * Article bodies as typed blocks without raw HTML: text is plain strings
 * plus inline marks, so there is nothing to sanitise. A footnote reference
 * `{ fn: "f1" }` must match an entry in `footnotes`, and every footnote must
 * be cited.
 */

const inlineSchema = z.union([
  z.string().min(1),
  z.strictObject({ em: z.string().min(1) }),
  z.strictObject({ strong: z.string().min(1) }),
  z.strictObject({ link: z.string().min(1), href: z.string().min(1) }),
  /** Footnote reference, rendered as a superscript that opens the source. */
  z.strictObject({ fn: z.string().regex(/^f\d+$/) }),
]);
export type Inline = z.infer<typeof inlineSchema>;

const textSchema = z.array(inlineSchema).min(1);

const blockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph"), text: textSchema }),
  z.strictObject({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("quote"),
    /** A quote from the verified bank (src/content/quotes.ts). */
    quoteId: z.enum(QUOTE_IDS as [string, ...string[]]),
  }),
  z.strictObject({
    type: z.literal("sourceQuote"),
    /** A short quote from a cited source (an advisory, a report), exact wording. */
    text: z.string().min(1),
    attribution: z.string().min(1),
    fn: z.string().regex(/^f\d+$/),
  }),
  z.strictObject({
    type: z.literal("image"),
    imageId: z.enum(SITE_IMAGE_IDS),
    caption: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("list"),
    style: z.enum(["bullet", "number"]),
    items: z.array(textSchema).min(1),
  }),
  z.strictObject({
    type: z.literal("callout"),
    tone: z.enum(["info", "success", "warning", "danger"]),
    title: z.string().optional(),
    body: z.array(textSchema).min(1),
  }),
]);
export type Block = z.infer<typeof blockSchema>;

const footnoteSchema = z.strictObject({
  id: z.string().regex(/^f\d+$/),
  /** "Publisher, “Title”, 12 Jan 2026" */
  text: z.string().min(1),
  url: z.url(),
});
export type Footnote = z.infer<typeof footnoteSchema>;

function citedIn(block: Block): string[] {
  const fromText = (text: Inline[]) =>
    text.flatMap((i) => (typeof i === "object" && "fn" in i ? [i.fn] : []));
  switch (block.type) {
    case "paragraph":
      return fromText(block.text);
    case "list":
      return block.items.flatMap(fromText);
    case "callout":
      return block.body.flatMap(fromText);
    case "sourceQuote":
      return [block.fn];
    default:
      return [];
  }
}

export const articleBodySchema = z
  .strictObject({
    blocks: z.array(blockSchema).min(1),
    footnotes: z.array(footnoteSchema),
  })
  .superRefine(({ blocks, footnotes }, ctx) => {
    const defined = new Set(footnotes.map((f) => f.id));
    const cited = new Set(blocks.flatMap(citedIn));
    if (defined.size !== footnotes.length)
      ctx.addIssue({ code: "custom", message: "duplicate footnote ids" });
    for (const id of cited)
      if (!defined.has(id))
        ctx.addIssue({
          code: "custom",
          message: `footnote ${id} has no source`,
        });
    for (const id of defined)
      if (!cited.has(id))
        ctx.addIssue({
          code: "custom",
          message: `footnote ${id} is never cited`,
        });
  });

export type ArticleBody = z.infer<typeof articleBodySchema>;
