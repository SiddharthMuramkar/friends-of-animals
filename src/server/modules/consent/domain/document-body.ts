// The body of a consent document: the short version and the sections of a
// policy page, in the same typed blocks as the repo's legal documents
// (src/content/legal/model.ts), so one renderer draws both and no HTML is
// ever stored or sanitised. Bodies are stored as jsonb and parsed here on
// the way in and on the way out.
//
// A body holds its words as agreed, so it has none of the repo text's
// clauses (words that only hold once FOA confirms their facts): what
// production leaves out is settled before publishing, not when a page
// renders.
//
// Loads under plain Node (schema, seed): relative imports only.

import { z } from "zod";

import {
  LEGAL_FACTS,
  type LegalDoc,
  type ShownInline,
} from "../../../../content/legal/model";
import { resolveLegalDoc } from "../../../../content/legal/resolve";

export type ConsentDocumentBody = Pick<
  LegalDoc<ShownInline>,
  "short" | "sections"
>;

/** Kebab-case letters, as the policy pages' anchors already are. */
export const SECTION_ID = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * Where a link in a document may point: a page on this site, an anchor in
 * the document, or an https address. Never another scheme.
 */
export function isAllowedHref(href: string): boolean {
  return /^(?:\/(?!\/)[^\s()]*|#[a-z0-9-]+|https:\/\/[^\s()]+)$/.test(href);
}

const inline = z.union([
  z.string().min(1),
  z.strictObject({ strong: z.string().min(1) }),
  z.strictObject({
    link: z.string().min(1),
    href: z.string().refine(isAllowedHref),
  }),
  z.strictObject({ fact: z.enum(LEGAL_FACTS) }),
]);

const text = z.array(inline).min(1);

const block = z.union([
  z.strictObject({ p: text }),
  z.strictObject({ list: z.array(text).min(1) }),
]);

const section = z.strictObject({
  id: z.string().regex(SECTION_ID),
  title: z.string().trim().min(1),
  blocks: z.array(block).min(1),
});

const bodySchema = z
  .strictObject({
    short: z.array(text),
    sections: z.array(section).min(1),
  })
  .refine(
    (body) =>
      new Set(body.sections.map((s) => s.id)).size === body.sections.length,
    { message: "Section ids must be unique" }
  );

export type ParsedBody =
  | { ok: true; body: ConsentDocumentBody }
  | { ok: false; issues: string[] };

/** Checks a stored or submitted body; never throws. */
export function parseConsentDocumentBody(value: unknown): ParsedBody {
  const result = bodySchema.safeParse(value);
  if (result.success) return { ok: true, body: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    ),
  };
}

/** Joins neighbouring words into one string, as the staff markup reads them. */
function joinWords(text: ShownInline[]): ShownInline[] {
  const out: ShownInline[] = [];
  for (const inline of text) {
    const last = out.at(-1);
    if (typeof inline === "string" && typeof last === "string") {
      out[out.length - 1] = last + inline;
    } else {
      out.push(inline);
    }
  }
  return out;
}

/**
 * A repo policy (src/content/legal) as the body of a published version,
 * as the seed publishes version 1: every clause keeps its words and facts
 * (which a page shows as tiles until FOA confirms them), and neighbouring
 * words join, so the body reads back unchanged through the staff markup.
 */
export function toConsentDocumentBody(doc: LegalDoc): ConsentDocumentBody {
  const { short, sections } = resolveLegalDoc(doc, () => true);
  return {
    short: short.map(joinWords),
    sections: sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        "p" in block
          ? { p: joinWords(block.p) }
          : { list: block.list.map(joinWords) }
      ),
    })),
  };
}
