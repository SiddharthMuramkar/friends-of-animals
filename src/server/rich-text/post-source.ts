// The plain-text source an editor writes for a post body (#112), and its
// conversion to and from the stored body (./post-body.ts). Like the consent
// documents' source (#64), it is a small, strict markup with no HTML, and
// the editor's preview is the parsed body rendered on the server, so the
// admin pages need no editor JavaScript:
//
//   A paragraph. Lines next to each other join into one paragraph, with
//   *emphasis*, **strong text**, a [link](https://example.org) and a
//   source mark.[^f1]
//
//   ## A heading
//   ### A smaller heading
//
//   - A bullet item
//   1. A numbered item
//
//   > [!info] An optional title (tones: info, success, warning, danger)
//   > A callout paragraph.
//   >
//   > Another paragraph in the same callout.
//
//   > Exact words from a source
//   > — Who said it, where [^f1]
//
//   @quote Q44                         (a quote from the verified bank)
//   @image <post image id> A caption   (an uploaded image of this post)
//   @image site:<site image id>        (a photo from the site's library)
//
//   [^f1]: Publisher, “Title”, 12 Jan 2026 <https://example.org/page>
//
// A backslash makes the next character plain text (\*, \[, \], \\, and
// \#, \-, \>, \@ or a digit at the start of a line). Marks never span
// lines. Every error comes back with its line, all at once.
//
// Relative imports only, like ./post-body.ts.

import { QUOTE_IDS } from "../../content/quotes";
import { SITE_IMAGE_IDS } from "../../lib/images/credits";
import { safeHref } from "./href";
import {
  CALLOUT_TONES,
  FOOTNOTE_ID,
  sanitizePostBody,
  sourceUrl,
  type PostBlock,
  type PostBody,
  type PostFootnote,
  type PostInline,
} from "./post-body";

export type PostSourceErrorCode =
  | "empty_body"
  | "invalid_heading"
  | "unclosed_strong"
  | "unclosed_em"
  | "empty_mark"
  | "unclosed_link"
  | "invalid_link"
  | "invalid_footnote_ref"
  | "unknown_footnote"
  | "uncited_footnote"
  | "duplicate_footnote"
  | "invalid_footnote"
  | "unknown_quote"
  | "invalid_image"
  | "unknown_site_image"
  | "unknown_directive"
  | "invalid_callout"
  | "empty_callout"
  | "invalid_source_quote"
  | "dangling_escape";

/** `line` is 1-based, or null for the body as a whole. */
export type PostSourceError = {
  line: number | null;
  code: PostSourceErrorCode;
};

export type ParsedPostSource =
  | { ok: true; body: PostBody }
  | { ok: false; errors: PostSourceError[] };

/** The longest source and line it reads, in UTF-16 code units. */
export const POST_SOURCE_LIMITS = { chars: 100_000, lineChars: 5_000 };

const POST_IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^-\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;
const DIRECTIVE = /^@([a-z-]*)(?:\s+(.*))?$/;
const FOOTNOTE_LINE = /^\[\^([^\]]*)\]:(.*)$/;
const FOOTNOTE_DEF = /^\s+(.*?)\s+<([^<>\s]+)>$/;
const CALLOUT_HEAD = /^\[!([a-z]*)\](?:\s+(.*))?$/;
const ATTRIBUTION = /^(?:—|--)\s+(.*?)\s*\[\^(f\d+)\]$/;
const FOOTNOTE_REF = /^\[\^(f\d+)\]/;

type Failure = { code: PostSourceErrorCode };

/** Reads from `start` up to `terminator` (or the end), applying escapes. */
function readUntil(
  raw: string,
  start: number,
  terminator: string | null
): { value: string; end: number } | null {
  let value = "";
  let i = start;
  while (i < raw.length) {
    if (raw[i] === "\\") {
      if (i + 1 >= raw.length) return null;
      value += raw[i + 1];
      i += 2;
    } else if (terminator !== null && raw.startsWith(terminator, i)) {
      return { value, end: i + terminator.length };
    } else {
      value += raw[i];
      i += 1;
    }
  }
  return terminator === null ? { value, end: i } : null;
}

/** One-line text with escapes applied: a heading, caption or title. */
function plainText(raw: string): string | Failure {
  const read = readUntil(raw, 0, null);
  return read ? read.value.trim() : { code: "dangling_escape" };
}

function parseInlines(raw: string): PostInline[] | Failure {
  const out: PostInline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(text);
    text = "";
  };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "\\") {
      if (i + 1 >= raw.length) return { code: "dangling_escape" };
      text += raw[i + 1];
      i += 2;
    } else if (raw.startsWith("**", i)) {
      const strong = readUntil(raw, i + 2, "**");
      if (!strong) return { code: "unclosed_strong" };
      if (!strong.value) return { code: "empty_mark" };
      flush();
      out.push({ strong: strong.value });
      i = strong.end;
    } else if (raw[i] === "*") {
      const em = readUntil(raw, i + 1, "*");
      if (!em) return { code: "unclosed_em" };
      if (!em.value) return { code: "empty_mark" };
      flush();
      out.push({ em: em.value });
      i = em.end;
    } else if (raw.startsWith("[^", i)) {
      const ref = FOOTNOTE_REF.exec(raw.slice(i));
      if (!ref) return { code: "invalid_footnote_ref" };
      flush();
      out.push({ fn: ref[1]! });
      i += ref[0].length;
    } else if (raw[i] === "[") {
      const label = readUntil(raw, i + 1, "]");
      if (!label || raw[label.end] !== "(") return { code: "unclosed_link" };
      const close = raw.indexOf(")", label.end + 1);
      if (close === -1) return { code: "unclosed_link" };
      const href = safeHref(raw.slice(label.end + 1, close));
      if (!label.value || !href) return { code: "invalid_link" };
      flush();
      out.push({ link: label.value, href });
      i = close + 1;
    } else {
      text += raw[i];
      i += 1;
    }
  }
  flush();
  return out;
}

/** Joins a paragraph's lines with spaces, merging neighbouring text. */
function joinLines(lines: PostInline[][]): PostInline[] {
  const out: PostInline[] = [];
  const push = (piece: PostInline) => {
    const last = out.at(-1);
    if (typeof piece === "string" && typeof last === "string") {
      out[out.length - 1] = last + piece;
    } else {
      out.push(piece);
    }
  };
  lines.forEach((line, k) => {
    if (k > 0) push(" ");
    line.forEach(push);
  });
  return out;
}

type Open =
  | { kind: "paragraph"; lines: PostInline[][] }
  | { kind: "list"; style: "bullet" | "number"; items: PostInline[][] }
  | { kind: "quote"; line: number; lines: string[] };

type Cite = { id: string; line: number };

class Parser {
  readonly errors: PostSourceError[] = [];
  readonly blocks: PostBlock[] = [];
  readonly footnotes: (PostFootnote & { line: number })[] = [];
  readonly cites: Cite[] = [];
  private open: Open | null = null;

  fail(line: number | null, code: PostSourceErrorCode) {
    this.errors.push({ line, code });
  }

  private inlines(line: number, raw: string): PostInline[] {
    const result = parseInlines(raw);
    if (!Array.isArray(result)) {
      this.fail(line, result.code);
      return [];
    }
    for (const piece of result) {
      if (typeof piece === "object" && "fn" in piece) {
        this.cites.push({ id: piece.fn, line });
      }
    }
    return result;
  }

  private plain(line: number, raw: string): string {
    const result = plainText(raw);
    if (typeof result !== "string") {
      this.fail(line, result.code);
      return "";
    }
    return result;
  }

  close() {
    const open = this.open;
    this.open = null;
    if (!open) return;
    if (open.kind === "paragraph") {
      this.blocks.push({ type: "paragraph", text: joinLines(open.lines) });
    } else if (open.kind === "list") {
      this.blocks.push({ type: "list", style: open.style, items: open.items });
    } else {
      this.closeQuote(open.line, open.lines);
    }
  }

  private closeQuote(line: number, lines: string[]) {
    const head = CALLOUT_HEAD.exec(lines[0]!);
    if (head) {
      this.closeCallout(line, head, lines.slice(1));
      return;
    }
    const attribution = ATTRIBUTION.exec(lines.at(-1)!);
    const words = lines.slice(0, -1);
    if (!attribution || words.length === 0 || words.some((w) => w === "")) {
      this.fail(line, "invalid_source_quote");
      return;
    }
    const fn = attribution[2]!;
    this.cites.push({ id: fn, line: line + lines.length - 1 });
    this.blocks.push({
      type: "sourceQuote",
      text: words.map((w, k) => this.plain(line + k, w)).join(" "),
      attribution: this.plain(line + lines.length - 1, attribution[1]!),
      fn,
    });
  }

  private closeCallout(line: number, head: RegExpExecArray, rest: string[]) {
    const tone = CALLOUT_TONES.find((known) => known === head[1]);
    if (!tone) {
      this.fail(line, "invalid_callout");
      return;
    }
    const title = head[2] === undefined ? "" : this.plain(line, head[2]);
    const body: PostInline[][] = [];
    let paragraph: PostInline[][] = [];
    const flush = () => {
      if (paragraph.length > 0) body.push(joinLines(paragraph));
      paragraph = [];
    };
    rest.forEach((raw, k) => {
      if (raw === "") flush();
      else paragraph.push(this.inlines(line + 1 + k, raw));
    });
    flush();
    if (body.length === 0) {
      this.fail(line, "empty_callout");
      return;
    }
    this.blocks.push(
      title
        ? { type: "callout", tone, title, body }
        : { type: "callout", tone, body }
    );
  }

  private directive(line: number, name: string, rest: string) {
    if (name === "quote") {
      const quoteId = QUOTE_IDS.find((known) => known === rest.trim());
      if (quoteId) this.blocks.push({ type: "quote", quoteId });
      else this.fail(line, "unknown_quote");
      return;
    }
    if (name !== "image") {
      this.fail(line, "unknown_directive");
      return;
    }
    const [ref = "", ...words] = rest.trim().split(/\s+/);
    const caption = this.plain(line, words.join(" "));
    const extra = caption ? { caption } : {};
    if (ref.startsWith("site:")) {
      const siteImageId = SITE_IMAGE_IDS.find((id) => id === ref.slice(5));
      if (siteImageId)
        this.blocks.push({ type: "image", siteImageId, ...extra });
      else this.fail(line, "unknown_site_image");
    } else if (POST_IMAGE_ID.test(ref)) {
      this.blocks.push({ type: "image", postImageId: ref, ...extra });
    } else {
      this.fail(line, "invalid_image");
    }
  }

  private footnote(line: number, id: string, rest: string) {
    const def = FOOTNOTE_DEF.exec(rest);
    const url = def ? sourceUrl(def[2]) : null;
    const text = def ? this.plain(line, def[1]!) : "";
    if (!FOOTNOTE_ID.test(id) || !url || !text) {
      this.fail(line, "invalid_footnote");
    } else if (this.footnotes.some((note) => note.id === id)) {
      this.fail(line, "duplicate_footnote");
    } else {
      this.footnotes.push({ id, text, url, line });
    }
  }

  read(rawLine: string, line: number) {
    const text = rawLine.trim();
    if (text === "") {
      this.close();
      return;
    }
    if (text.startsWith(">")) {
      const inner = text.slice(1).trim();
      if (this.open?.kind !== "quote") {
        this.close();
        this.open = { kind: "quote", line, lines: [] };
      }
      this.open.lines.push(inner);
      return;
    }
    const heading = HEADING.exec(text);
    const directive = DIRECTIVE.exec(text);
    const footnote = FOOTNOTE_LINE.exec(text);
    const bullet = BULLET.exec(text);
    const numbered = NUMBERED.exec(text);
    if (heading) {
      this.close();
      const level = heading[1]!.length;
      if (level !== 2 && level !== 3) {
        this.fail(line, "invalid_heading");
        return;
      }
      this.blocks.push({
        type: "heading",
        level,
        text: this.plain(line, heading[2]!),
      });
    } else if (directive) {
      this.close();
      this.directive(line, directive[1]!, directive[2] ?? "");
    } else if (footnote) {
      this.close();
      this.footnote(line, footnote[1]!, footnote[2]!);
    } else if (bullet || numbered) {
      const style = bullet ? "bullet" : "number";
      if (this.open?.kind !== "list" || this.open.style !== style) {
        this.close();
        this.open = { kind: "list", style, items: [] };
      }
      this.open.items.push(this.inlines(line, (bullet ?? numbered)![1]!));
    } else {
      if (this.open?.kind !== "paragraph") {
        this.close();
        this.open = { kind: "paragraph", lines: [] };
      }
      this.open.lines.push(this.inlines(line, text));
    }
  }

  checkSources() {
    const defined = new Set(this.footnotes.map((note) => note.id));
    const cited = new Set(this.cites.map((cite) => cite.id));
    for (const cite of this.cites) {
      if (!defined.has(cite.id)) this.fail(cite.line, "unknown_footnote");
    }
    for (const note of this.footnotes) {
      if (!cited.has(note.id)) this.fail(note.line, "uncited_footnote");
    }
  }
}

/** Parses an editor's source into a safe body, or every error with its line. */
export function parsePostSource(source: string): ParsedPostSource {
  const parser = new Parser();
  source.split(/\r?\n/).forEach((raw, index) => parser.read(raw, index + 1));
  parser.close();
  parser.checkSources();
  if (parser.blocks.length === 0 && parser.errors.length === 0) {
    parser.fail(null, "empty_body");
  }
  if (parser.errors.length > 0) {
    const order = (error: PostSourceError) => error.line ?? Infinity;
    const errors = parser.errors.sort((a, b) => order(a) - order(b));
    return { ok: false, errors };
  }
  const footnotes = parser.footnotes.map(({ id, text, url }) => ({
    id,
    text,
    url,
  }));
  return {
    ok: true,
    body: sanitizePostBody({ blocks: parser.blocks, footnotes }),
  };
}

function escapeText(text: string): string {
  return text.replace(/[\\*[\]]/g, (mark) => `\\${mark}`);
}

/** A line of text that would otherwise start a heading, list, quote or directive. */
const LINE_START_MARKUP = /^(?:#|-\s|\d+\.\s|>|@)/;

function formatInlines(line: PostInline[]): string {
  const out = line
    .map((piece) => {
      if (typeof piece === "string") return escapeText(piece);
      if ("em" in piece) return `*${escapeText(piece.em)}*`;
      if ("strong" in piece) return `**${escapeText(piece.strong)}**`;
      if ("fn" in piece) return `[^${piece.fn}]`;
      const label = escapeText(piece.link).replace(/^\^/, "\\^");
      return `[${label}](${piece.href})`;
    })
    .join("");
  return LINE_START_MARKUP.test(out) ? `\\${out}` : out;
}

function formatPlain(text: string): string {
  const out = escapeText(text);
  return LINE_START_MARKUP.test(out) ? `\\${out}` : out;
}

function formatBlock(block: PostBlock): string {
  switch (block.type) {
    case "paragraph":
      return formatInlines(block.text);
    case "heading":
      return `${"#".repeat(block.level)} ${escapeText(block.text)}`;
    case "quote":
      return `@quote ${block.quoteId}`;
    case "sourceQuote":
      return [
        `> ${formatPlain(block.text)}`,
        `> — ${escapeText(block.attribution)} [^${block.fn}]`,
      ].join("\n");
    case "image": {
      const ref =
        "postImageId" in block
          ? block.postImageId
          : `site:${block.siteImageId}`;
      return block.caption
        ? `@image ${ref} ${escapeText(block.caption)}`
        : `@image ${ref}`;
    }
    case "list":
      return block.items
        .map((item, k) => {
          const mark = block.style === "bullet" ? "-" : `${k + 1}.`;
          return `${mark} ${formatInlines(item)}`;
        })
        .join("\n");
    case "callout": {
      const head = `> [!${block.tone}]${block.title ? ` ${escapeText(block.title)}` : ""}`;
      const paragraphs = block.body.map((line) => `> ${formatInlines(line)}`);
      return [head, paragraphs.join("\n>\n")].join("\n");
    }
  }
}

/** Writes a body as source, so an editor can change a saved post. */
export function formatPostSource(body: PostBody): string {
  const chunks = body.blocks.map(formatBlock);
  if (body.footnotes.length > 0) {
    chunks.push(
      body.footnotes
        .map((note) => `[^${note.id}]: ${escapeText(note.text)} <${note.url}>`)
        .join("\n")
    );
  }
  return chunks.length > 0 ? `${chunks.join("\n\n")}\n` : "";
}
