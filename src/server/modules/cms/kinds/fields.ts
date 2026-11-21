// Building blocks for the CMS kinds' body schemas (#111). A kind checks a
// body when a content manager saves it, and checks it again when a page
// renders it, so a row that slipped past an older schema can't reach the
// page: the same schema strips markup both times.
//
// Loads under plain Node (seed): relative imports only.

import { z } from "zod";

import type { LegalBlock } from "../../../../content/legal/model";
import { sanitizeBlocks, sanitizePlainText } from "../../../rich-text/blocks";

/** An issue at `path` for each key listed more than once in `keys`. */
export function uniqueKeys<Key extends string>(
  keys: readonly Key[],
  ctx: z.core.$RefinementCtx,
  path: PropertyKey[] = []
): void {
  const seen = new Set<Key>();
  for (const key of keys) {
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `${key} is listed more than once`,
      });
    }
    seen.add(key);
  }
}

export type KindParseResult<Body> =
  | { ok: true; body: Body }
  | { ok: false; issues: string[] };

/**
 * A one-line text field: markup stripped and spaces collapsed first, then
 * checked for length. Required fields must keep some text after stripping.
 */
export function plainText(max: number, { allowEmpty = false } = {}) {
  const checked = z.string().max(max);
  return z
    .string()
    .transform(sanitizePlainText)
    .pipe(allowEmpty ? checked : checked.min(1, { error: "write some text" }));
}

/**
 * Paragraphs and lists through the one rich-text sanitiser: unsafe pieces
 * are dropped or become text, never refused. A field must keep some text.
 */
export function richBlocks() {
  return z
    .unknown()
    .transform((value): LegalBlock[] => sanitizeBlocks(value, "cms"))
    .refine((blocks) => blocks.length > 0, { error: "write some text" });
}

function issueText(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * A CMS kind from its body schema and its seed body (the repo's copy, which
 * is the first published revision and the page's text when a build has no
 * database). `parse` refuses a bad draft with readable issues; `sanitize`
 * never throws: a stored body that no longer fits renders as `fallback`,
 * the seed unless the kind says otherwise.
 */
export function kindOf<Schema extends z.ZodType>(
  schema: Schema,
  seed: z.output<Schema>,
  { fallback }: { fallback?: () => z.output<Schema> } = {}
) {
  type Body = z.output<Schema>;
  const seedBody = (): Body => structuredClone(seed);
  const renderFallback = fallback ?? seedBody;
  const parse = (value: unknown): KindParseResult<Body> => {
    const result = schema.safeParse(value);
    return result.success
      ? { ok: true, body: result.data }
      : { ok: false, issues: result.error.issues.map(issueText) };
  };
  const sanitize = (value: unknown): Body => {
    const result = parse(value);
    return result.ok ? result.body : renderFallback();
  };
  return { parse, sanitize, seedBody };
}
