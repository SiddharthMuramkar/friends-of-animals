// The `post` profile of the rich-text sanitiser (#112): the body of a blog
// post or story. It is the published stories' block shape
// (src/content/stories/model.ts), so every story imports unchanged and
// React renders it as text nodes and elements it chooses, never HTML. One
// difference: an image names an uploaded post image (`postImageId`, whose
// public derivative the page shows) or a site photo (`siteImageId`), never
// a URL or a storage key, so no external host or original upload can ever
// be stored in a body.
//
// Like the `cms` profile (./blocks.ts), every save and every read passes
// the value through here, and it never throws:
//
//   - markup in any string is stripped (./strip-markup.ts);
//   - a link whose address fails the allowlist (./href.ts) becomes text;
//   - a source must have a web address and be cited; a reference to a
//     missing source is dropped;
//   - unknown blocks, unknown values and extra keys (an image's `src`,
//     `url` or `key`) are dropped;
//   - empty pieces and blocks are dropped.
//
// Whether a `postImageId` belongs to the post is the use case's check.
//
// Relative imports only, like ./blocks.ts.

import { QUOTE_IDS, type QuoteId } from "../../content/quotes";
import type { Footnote, Inline } from "../../content/stories/model";
import { SITE_IMAGE_IDS, type SiteImageId } from "../../lib/images/credits";
import { safeHref } from "./href";
import { stripMarkup } from "./strip-markup";

export type PostInline = Inline;
export type PostFootnote = Footnote;

export const CALLOUT_TONES = ["info", "success", "warning", "danger"] as const;
export const LIST_STYLES = ["bullet", "number"] as const;

export type PostImageRef =
  | { postImageId: string }
  | { siteImageId: SiteImageId };

export type PostBlock =
  | { type: "paragraph"; text: PostInline[] }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "quote"; quoteId: QuoteId }
  | { type: "sourceQuote"; text: string; attribution: string; fn: string }
  | ({ type: "image"; caption?: string } & PostImageRef)
  | {
      type: "list";
      style: (typeof LIST_STYLES)[number];
      items: PostInline[][];
    }
  | {
      type: "callout";
      tone: (typeof CALLOUT_TONES)[number];
      title?: string;
      body: PostInline[][];
    };

export type PostBody = { blocks: PostBlock[]; footnotes: PostFootnote[] };

/** A footnote id, as the stories number them. */
export const FOOTNOTE_ID = /^f\d+$/;

/** A post image's id: a UUID, as `uuidv7` writes it. */
const POST_IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown
): T | null {
  return allowed.find((known) => known === value) ?? null;
}

/** A run of text inside a line: markup stripped, spacing kept. */
function text(value: unknown): string {
  return typeof value === "string" ? stripMarkup(value) : "";
}

/** A one-line field: markup stripped, spaces collapsed. */
function plain(value: unknown): string {
  return text(value).replace(/\s+/g, " ").trim();
}

/**
 * A source's address: a web page, over https or, for an older site that
 * has no https (three published stories cite one), http. It is only ever
 * a link, so http is no risk to the page.
 */
function sourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  const asHttps = url.startsWith("http://") ? `https://${url.slice(7)}` : url;
  return safeHref(asHttps)?.startsWith("https://") ? url : null;
}

/** Sources the blocks may cite: in order, first of each id wins. */
function safeFootnotes(value: unknown): PostFootnote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: PostFootnote[] = [];
  for (const raw of value) {
    if (!isFields(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!FOOTNOTE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const note = plain(raw.text);
    const url = sourceUrl(raw.url);
    if (note && url) {
      out.push({ id, text: note, url });
    }
  }
  return out;
}

class Sanitizer {
  constructor(private readonly sources: ReadonlySet<string>) {}

  private inline(value: unknown): PostInline | null {
    if (typeof value === "string") return text(value) || null;
    if (!isFields(value)) return null;
    if ("em" in value) {
      const em = text(value.em);
      return em ? { em } : null;
    }
    if ("strong" in value) {
      const strong = text(value.strong);
      return strong ? { strong } : null;
    }
    if ("link" in value) {
      const label = text(value.link);
      if (!label) return null;
      const href = typeof value.href === "string" ? safeHref(value.href) : null;
      return href ? { link: label, href } : label;
    }
    if ("fn" in value) {
      return typeof value.fn === "string" && this.sources.has(value.fn)
        ? { fn: value.fn }
        : null;
    }
    return null;
  }

  line(value: unknown): PostInline[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((piece) => this.inline(piece))
      .filter((piece) => piece !== null);
  }

  private lines(value: unknown): PostInline[][] {
    if (!Array.isArray(value)) return [];
    return value
      .map((line) => this.line(line))
      .filter((line) => line.length > 0);
  }

  private image(value: Fields): PostBlock | null {
    const hasPost = "postImageId" in value;
    const hasSite = "siteImageId" in value;
    if (hasPost === hasSite) return null;
    const caption = plain(value.caption);
    const extra = caption ? { caption } : {};
    if (hasPost) {
      const id = value.postImageId;
      return typeof id === "string" && POST_IMAGE_ID.test(id)
        ? { type: "image", postImageId: id, ...extra }
        : null;
    }
    const siteImageId = oneOf(SITE_IMAGE_IDS, value.siteImageId);
    return siteImageId ? { type: "image", siteImageId, ...extra } : null;
  }

  block(value: unknown): PostBlock | null {
    if (!isFields(value)) return null;
    switch (value.type) {
      case "paragraph": {
        const line = this.line(value.text);
        return line.length > 0 ? { type: "paragraph", text: line } : null;
      }
      case "heading": {
        const heading = plain(value.text);
        const level = value.level === 2 || value.level === 3 ? value.level : 0;
        return heading && level
          ? { type: "heading", level, text: heading }
          : null;
      }
      case "quote": {
        const quoteId = oneOf(QUOTE_IDS, value.quoteId);
        return quoteId ? { type: "quote", quoteId } : null;
      }
      case "sourceQuote": {
        const quoted = plain(value.text);
        const attribution = plain(value.attribution);
        const fn = typeof value.fn === "string" ? value.fn : "";
        return quoted && attribution && this.sources.has(fn)
          ? { type: "sourceQuote", text: quoted, attribution, fn }
          : null;
      }
      case "image":
        return this.image(value);
      case "list": {
        const style = oneOf(LIST_STYLES, value.style);
        const items = this.lines(value.items);
        return style && items.length > 0
          ? { type: "list", style, items }
          : null;
      }
      case "callout": {
        const tone = oneOf(CALLOUT_TONES, value.tone);
        const title = plain(value.title);
        const body = this.lines(value.body);
        if (!tone || body.length === 0) return null;
        return title
          ? { type: "callout", tone, title, body }
          : { type: "callout", tone, body };
      }
      default:
        return null;
    }
  }
}

function citedIn(block: PostBlock): string[] {
  const fromLine = (line: PostInline[]) =>
    line.flatMap((piece) =>
      typeof piece === "object" && "fn" in piece ? [piece.fn] : []
    );
  switch (block.type) {
    case "paragraph":
      return fromLine(block.text);
    case "list":
      return block.items.flatMap(fromLine);
    case "callout":
      return block.body.flatMap(fromLine);
    case "sourceQuote":
      return [block.fn];
    default:
      return [];
  }
}

/** The safe, non-empty blocks of `value` and the sources they cite. */
export function sanitizePostBody(value: unknown): PostBody {
  if (!isFields(value)) return { blocks: [], footnotes: [] };
  const footnotes = safeFootnotes(value.footnotes);
  const sanitizer = new Sanitizer(new Set(footnotes.map((note) => note.id)));
  const blocks = Array.isArray(value.blocks)
    ? value.blocks
        .map((raw) => sanitizer.block(raw))
        .filter((block) => block !== null)
    : [];
  const cited = new Set(blocks.flatMap(citedIn));
  return {
    blocks,
    footnotes: footnotes.filter((note) => cited.has(note.id)),
  };
}

/** The uploaded images `body` shows, each once, in order of appearance. */
export function postImageIdsIn(body: PostBody): string[] {
  const ids = body.blocks.flatMap((block) =>
    block.type === "image" && "postImageId" in block ? [block.postImageId] : []
  );
  return [...new Set(ids)];
}
