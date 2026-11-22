// The post editor's form (#112): what it submits, the use case's input
// made from it, and what it shows after a save that didn't go through.
// The body is written in the post markup (src/server/rich-text/
// post-source.ts) and parsed here, on the server, so the editor needs no
// JavaScript of its own. Anything odd passes through for the use case to
// refuse by field. Pure, so it is tested without a page.

import type {
  PostForEdit,
  PostInput,
  PostInputRefusal,
} from "@/server/modules/cms";
import type { PostImageRef } from "@/server/rich-text/post-body";
import {
  formatPostSource,
  parsePostSource,
  type PostSourceError,
} from "@/server/rich-text/post-source";

/** Every input of the form, as typed. */
export type PostFormValues = {
  kind: string;
  title: string;
  slug: string;
  excerpt: string;
  seoTitle: string;
  easyRead: string;
  authorName: string;
  audience: string;
  /** Words separated by commas or spaces. */
  topics: string;
  featured: boolean;
  /** "" for none, `post:<image id>` or `site:<site image id>`. */
  cover: string;
  /** The body in the post markup. */
  source: string;
};

export type PostFormAlert =
  | "failed"
  | "unknownImage"
  | "imageNotReady"
  | "archived"
  | "notFound";

/** What the form shows after a save that didn't go through. */
export type PostFormState = {
  /** Goes up on every refused save, so the form re-reads `values`. */
  attempt: number;
  values: PostFormValues;
  /** A refusal code per field: `required`, `too_long`, `taken`… */
  errors: Partial<Record<string, string>>;
  sourceErrors: PostSourceError[];
  alert?: PostFormAlert;
};

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function readPostForm(form: FormData): PostFormValues {
  return {
    kind: text(form, "kind"),
    title: text(form, "title"),
    slug: text(form, "slug"),
    excerpt: text(form, "excerpt"),
    seoTitle: text(form, "seoTitle"),
    easyRead: text(form, "easyRead"),
    authorName: text(form, "authorName"),
    audience: text(form, "audience"),
    topics: text(form, "topics"),
    featured: text(form, "featured") !== "",
    cover: text(form, "cover"),
    source: text(form, "source"),
  };
}

/** The cover the form's choice names, or null for none. */
function coverOf(choice: string): PostImageRef | null {
  if (choice.startsWith("post:")) return { postImageId: choice.slice(5) };
  if (choice.startsWith("site:")) {
    return { siteImageId: choice.slice(5) } as PostImageRef;
  }
  return null;
}

/** The form's choice for a cover: the inverse of coverOf. */
export function coverChoice(cover: PostImageRef | null): string {
  if (!cover) return "";
  return "postImageId" in cover
    ? `post:${cover.postImageId}`
    : `site:${cover.siteImageId}`;
}

/** The use case's input, or the markup's errors by line. */
export function postInputOf(
  values: PostFormValues
):
  | { ok: true; input: PostInput }
  | { ok: false; sourceErrors: PostSourceError[] } {
  const parsed = parsePostSource(values.source);
  if (!parsed.ok) return { ok: false, sourceErrors: parsed.errors };
  return {
    ok: true,
    input: {
      // The use case refuses a kind or audience it doesn't know.
      kind: values.kind as PostInput["kind"],
      title: values.title,
      slug: values.slug,
      excerpt: values.excerpt,
      seoTitle: values.seoTitle,
      easyRead: values.easyRead,
      authorName: values.authorName,
      audience: values.audience as PostInput["audience"],
      topics: values.topics.split(/[\s,]+/).filter((topic) => topic !== ""),
      featured: values.featured,
      cover: coverOf(values.cover) as PostInput["cover"],
      body: parsed.body,
    },
  };
}

/** The form, prefilled from a saved post. */
export function postFormOf(
  post: Pick<
    PostForEdit,
    | "kind"
    | "title"
    | "slug"
    | "excerpt"
    | "seoTitle"
    | "easyRead"
    | "authorName"
    | "audience"
    | "topics"
    | "featured"
    | "cover"
    | "body"
  >
): PostFormValues {
  return {
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    seoTitle: post.seoTitle ?? "",
    easyRead: post.easyRead ?? "",
    authorName: post.authorName ?? "",
    audience: post.audience,
    topics: post.topics.join(", "),
    featured: post.featured,
    cover: coverChoice(post.cover),
    source: formatPostSource(post.body),
  };
}

/** A new post's form. */
export function emptyPostForm(): PostFormValues {
  return {
    kind: "blog",
    title: "",
    slug: "",
    excerpt: "",
    seoTitle: "",
    easyRead: "",
    authorName: "",
    audience: "everyone",
    topics: "",
    featured: false,
    cover: "",
    source: "",
  };
}

type Refused =
  | PostInputRefusal
  | {
      ok: false;
      error: "unknown_image" | "image_not_ready" | "archived" | "not_found";
    };

const ALERTS = {
  unknown_image: "unknownImage",
  image_not_ready: "imageNotReady",
  archived: "archived",
  not_found: "notFound",
} as const satisfies Record<
  Exclude<Refused["error"], "invalid_input">,
  PostFormAlert
>;

/** The form after a save the use case refused. */
export function afterSave(
  result: Refused,
  values: PostFormValues,
  attempt: number
): PostFormState {
  const base = { attempt: attempt + 1, values, sourceErrors: [] };
  if (result.error === "invalid_input") {
    return { ...base, errors: result.errors };
  }
  return { ...base, errors: {}, alert: ALERTS[result.error] };
}
