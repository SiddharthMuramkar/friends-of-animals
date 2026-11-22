// What an editor sends for a post, and how it becomes the stored fields
// (#112). Every string is made plain text (markup stripped, spaces
// collapsed), the body goes through the `post` profile of the sanitiser,
// and every refusal comes back at once, by field, so the form can mark
// each one. Whether the address is free and the images belong to the post
// are the use cases' checks, against the database.
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

import { SITE_IMAGE_IDS } from "../../../../lib/images/credits";
import { sanitizePlainText } from "../../../rich-text/blocks";
import {
  sanitizePostBody,
  type PostBody,
  type PostImageRef,
} from "../../../rich-text/post-body";
import { checkPostFields } from "../domain/post-fields";
import {
  POST_AUDIENCES,
  POST_KINDS,
  type PostAudience,
  type PostKind,
} from "../domain/post-kinds";
import { checkPostSlug, postSlugFrom } from "../domain/post-slug";

/** A topic, as the published stories tag theirs: `history`, `street-dogs`. */
const TOPIC = /^[a-z]+(?:-[a-z]+)*$/;

/** Generous outer bounds; the real limits are checkPostFields'. */
const LONG_TEXT = 5000;

const coverInput = z.union([
  z.strictObject({ postImageId: z.uuid() }),
  z.strictObject({ siteImageId: z.enum(SITE_IMAGE_IDS) }),
]);

export const postInputSchema = z.object({
  kind: z.enum(POST_KINDS),
  title: z.string().max(LONG_TEXT),
  /** Blank: made from the title. */
  slug: z.string().max(LONG_TEXT).optional(),
  seoTitle: z.string().max(LONG_TEXT).optional(),
  excerpt: z.string().max(LONG_TEXT).optional(),
  easyRead: z.string().max(LONG_TEXT).optional(),
  audience: z.enum(POST_AUDIENCES).optional(),
  topics: z.array(z.string().max(40).regex(TOPIC)).max(8).optional(),
  featured: z.boolean().optional(),
  authorName: z.string().max(LONG_TEXT).optional(),
  body: z.unknown(),
  /** An uploaded image of this post, or a photo from the site's library. */
  cover: coverInput.nullable().optional(),
});

export type PostInput = z.input<typeof postInputSchema>;

/** A field the editor can be told about. */
export type PostInputField = keyof PostInput | "coverAlt";

/**
 * Input that can't be saved: every field at fault (a PostInputField, or
 * another use case's own field), and why.
 */
export type PostInputRefusal = {
  ok: false;
  error: "invalid_input";
  fields: string[];
  errors: Partial<Record<string, string>>;
};

/** The columns a post's input sets, cleaned. */
export type PostValues = {
  kind: PostKind;
  slug: string;
  title: string;
  seoTitle: string | null;
  excerpt: string;
  easyRead: string | null;
  audience: PostAudience;
  topics: string[];
  featured: boolean;
  authorName: string | null;
  body: PostBody;
  coverImageId: string | null;
  coverSiteImageId: string | null;
};

export function refusal(
  errors: Partial<Record<string, string>>
): PostInputRefusal {
  return {
    ok: false,
    error: "invalid_input",
    fields: Object.keys(errors),
    errors,
  };
}

function optional(value: string | undefined): string | null {
  const clean = sanitizePlainText(value ?? "");
  return clean.length > 0 ? clean : null;
}

/** The cover, as a body image names it. */
export function coverRef(values: PostValues): PostImageRef | null {
  if (values.coverImageId) return { postImageId: values.coverImageId };
  if (values.coverSiteImageId) {
    return { siteImageId: values.coverSiteImageId } as PostImageRef;
  }
  return null;
}

/**
 * The post's columns from `input`, or every refusal. `draft` relaxes what
 * only going live needs (checkPostFields). The uploaded cover's alt text is
 * the use case's check, once it has found the image.
 */
export function readPostInput(
  input: unknown,
  { draft }: { draft: boolean }
): { ok: true; values: PostValues } | PostInputRefusal {
  const parsed = postInputSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ];
    return refusal(
      Object.fromEntries(fields.map((field) => [field, "invalid"]))
    );
  }
  const data = parsed.data;
  const title = sanitizePlainText(data.title);
  const seoTitle = optional(data.seoTitle);
  const excerpt = sanitizePlainText(data.excerpt ?? "");
  const easyRead = optional(data.easyRead);
  const authorName = optional(data.authorName);
  const cover = data.cover ?? null;

  const errors: Partial<Record<PostInputField, string>> = {};
  const fields = checkPostFields(
    {
      title,
      seoTitle: seoTitle ?? undefined,
      excerpt,
      easyRead: easyRead ?? undefined,
      authorName: authorName ?? undefined,
    },
    { draft }
  );
  if (!fields.ok) Object.assign(errors, fields.errors);

  const chosen = (data.slug ?? "").trim();
  const slug = chosen.length > 0 ? chosen : postSlugFrom(title);
  if (slug === null) {
    errors.slug = "required";
  } else {
    const check = checkPostSlug(slug);
    if (!check.ok) errors.slug = check.refusal;
  }

  if (Object.keys(errors).length > 0 || slug === null) return refusal(errors);
  return {
    ok: true,
    values: {
      kind: data.kind,
      slug,
      title,
      seoTitle,
      excerpt,
      easyRead,
      audience: data.audience ?? "everyone",
      topics: [...new Set(data.topics ?? [])],
      featured: data.featured ?? false,
      authorName,
      body: sanitizePostBody(data.body),
      coverImageId: cover && "postImageId" in cover ? cover.postImageId : null,
      coverSiteImageId:
        cover && "siteImageId" in cover ? cover.siteImageId : null,
    },
  };
}
