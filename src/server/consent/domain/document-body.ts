// The body of a consent document: the short version and the sections of a
// policy page, in the same typed blocks as the repo's legal documents
// (src/content/legal/model.ts), so one renderer draws both and no HTML is
// ever stored or sanitised. Bodies are stored as jsonb and parsed here on
// the way in and on the way out.
//
// Loads under plain Node (schema, seed): relative imports only.

import { z } from "zod";

import {
  LEGAL_FACTS,
  type LegalDoc,
  type ShownInline,
} from "../../../content/legal/model";

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
