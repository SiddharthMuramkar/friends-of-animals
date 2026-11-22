// The words around a post's body, and their limits. The limits are the
// published stories' own (src/content/stories/index.ts), so every story
// imports unchanged. A title that would pass the 60-character browser-tab
// limit once " · Friends of Animals" is added needs a shorter search title.
//
// Lengths are counted on the trimmed text, in UTF-16 code units, as zod's
// `.max()` counts them.
//
// Loads under plain Node (the worker reaches it through ../posts/gates.ts):
// relative imports only.

import { renderedTitle, TITLE_MAX } from "../../../../lib/seo";

export const POST_FIELD_MAX = {
  title: 80,
  excerpt: 300,
  easyRead: 200,
  authorName: 80,
  coverAlt: 200,
} as const;

export type PostFields = {
  title: string;
  /** Shown in search results and the browser tab instead of the title. */
  seoTitle?: string | undefined;
  /** The dek under the title and on cards. */
  excerpt: string;
  /** One or two sentences at grade 6 or below. */
  easyRead?: string | undefined;
  authorName?: string | undefined;
  /** Present when the post has an uploaded cover image. */
  cover?: { alt: string } | undefined;
};

export type PostField = Exclude<keyof PostFields, "cover"> | "coverAlt";

export type PostFieldRefusal = "required" | "too_long";

export type PostFieldsCheck =
  | { ok: true }
  | { ok: false; errors: Partial<Record<PostField, PostFieldRefusal>> };

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function fitsTab(title: string): boolean {
  return renderedTitle(title.trim()).length <= TITLE_MAX;
}

/**
 * Every field's refusal at once, so a form can mark each one. A draft
 * (`{ draft: true }`) may leave what only going live needs, the excerpt,
 * the cover's alt text and a search title, for later; every length still
 * counts.
 */
export function checkPostFields(
  fields: PostFields,
  { draft = false }: { draft?: boolean } = {}
): PostFieldsCheck {
  const live = !draft;
  const errors: Partial<Record<PostField, PostFieldRefusal>> = {};
  const limit = (
    field: keyof typeof POST_FIELD_MAX,
    value: string | undefined,
    required: boolean
  ) => {
    if (blank(value)) {
      if (required) errors[field] = "required";
    } else if (value!.trim().length > POST_FIELD_MAX[field]) {
      errors[field] = "too_long";
    }
  };

  limit("title", fields.title, true);
  limit("excerpt", fields.excerpt, live);
  limit("easyRead", fields.easyRead, false);
  limit("authorName", fields.authorName, false);
  if (fields.cover) limit("coverAlt", fields.cover.alt, live);

  if (!blank(fields.seoTitle)) {
    if (!fitsTab(fields.seoTitle!)) errors.seoTitle = "too_long";
  } else if (live && !blank(fields.title) && !fitsTab(fields.title)) {
    errors.seoTitle = "required";
  }

  return Object.keys(errors).length === 0
    ? { ok: true }
    : { ok: false, errors };
}

/** The title for the browser tab, search results and social cards. */
export function postMetaTitle(
  fields: Pick<PostFields, "title" | "seoTitle">
): string {
  return blank(fields.seoTitle) ? fields.title.trim() : fields.seoTitle!.trim();
}
