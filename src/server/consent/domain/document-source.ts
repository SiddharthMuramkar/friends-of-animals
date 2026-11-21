// The plain-text source staff write when they publish a consent document,
// and its conversion to and from the stored body. It is a small, strict
// markup with no HTML, so nothing needs sanitising:
//
//   - A short-version point (only before the first section)
//
//   ## Section title {#optional-id}
//   A paragraph. Lines next to each other join into one paragraph.
//
//   - A list item with **strong text**, a [link](/privacy) and {{email}}
//
// A backslash makes the next character plain text (\*, \[, \{, \\, and \-
// or \# at the start of a line). Marks never span lines. Section ids default
// to the title in kebab-case letters.
//
// Loads under plain Node (seed): relative imports only.

import {
  LEGAL_FACTS,
  type LegalFact,
  type ShownInline,
} from "../../../content/legal/model";
import {
  isAllowedHref,
  parseConsentDocumentBody,
  SECTION_ID,
  type ConsentDocumentBody,
} from "./document-body";

export type SourceErrorCode =
  | "no_sections"
  | "text_before_first_section"
  | "empty_section"
  | "invalid_section_id"
  | "duplicate_section_id"
  | "unclosed_strong"
  | "empty_strong"
  | "unclosed_link"
  | "invalid_link"
  | "unknown_fact"
  | "unclosed_fact"
  | "dangling_escape"
  /** The source parsed but the body breaks a rule the parser missed. */
  | "invalid_document";

/** `line` is 1-based, or null for the document as a whole. */
export type SourceError = { line: number | null; code: SourceErrorCode };

export type ParsedSource =
  | { ok: true; body: ConsentDocumentBody }
  | { ok: false; errors: SourceError[] };

type Section = ConsentDocumentBody["sections"][number];
type Block = Section["blocks"][number];

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isLegalFact(name: string): name is LegalFact {
  return (LEGAL_FACTS as readonly string[]).includes(name);
}

/** Reads from `start` up to `terminator`, applying escapes. */
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

type InlineResult = ShownInline[] | SourceErrorCode;

function parseInlines(raw: string): InlineResult {
  const out: ShownInline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(text);
    text = "";
  };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "\\") {
      if (i + 1 >= raw.length) return "dangling_escape";
      text += raw[i + 1];
      i += 2;
    } else if (raw.startsWith("**", i)) {
      const strong = readUntil(raw, i + 2, "**");
      if (!strong) return "unclosed_strong";
      if (!strong.value) return "empty_strong";
      flush();
      out.push({ strong: strong.value });
      i = strong.end;
    } else if (raw[i] === "[") {
      const label = readUntil(raw, i + 1, "]");
      if (!label || raw[label.end] !== "(") return "unclosed_link";
      const close = raw.indexOf(")", label.end + 1);
      if (close === -1) return "unclosed_link";
      const href = raw.slice(label.end + 1, close);
      if (!label.value || !isAllowedHref(href)) return "invalid_link";
      flush();
      out.push({ link: label.value, href });
      i = close + 1;
    } else if (raw.startsWith("{{", i)) {
      const close = raw.indexOf("}}", i + 2);
      if (close === -1) return "unclosed_fact";
      const name = raw.slice(i + 2, close);
      if (!isLegalFact(name)) return "unknown_fact";
      flush();
      out.push({ fact: name });
      i = close + 2;
    } else {
      text += raw[i];
      i += 1;
    }
  }
  flush();
  return out;
}

/** Joins a paragraph's lines with spaces, merging neighbouring text. */
function joinLines(lines: ShownInline[][]): ShownInline[] {
  const out: ShownInline[] = [];
  const push = (inline: ShownInline) => {
    const last = out.at(-1);
    if (typeof inline === "string" && typeof last === "string") {
      out[out.length - 1] = last + inline;
    } else {
      out.push(inline);
    }
  };
  lines.forEach((line, k) => {
    if (k > 0) push(" ");
    line.forEach(push);
  });
  return out;
}

const HEADING = /^##\s+(.*)$/;
const EXPLICIT_ID = /^(.*?)\s*(?<!\\)\{#([^\s{}\\]*)\}$/;

/** Parses staff-written source into a body, or every error with its line. */
export function parseConsentDocumentSource(source: string): ParsedSource {
  const errors: SourceError[] = [];
  const short: ShownInline[][] = [];
  const sections: (Section & { line: number })[] = [];
  const ids = new Set<string>();
  let paragraph: ShownInline[][] | null = null;
  let list: ShownInline[][] | null = null;

  const fail = (line: number | null, code: SourceErrorCode) => {
    errors.push({ line, code });
  };
  const closeBlock = () => {
    const blocks = sections.at(-1)?.blocks;
    if (blocks && paragraph) blocks.push({ p: joinLines(paragraph) });
    if (blocks && list) blocks.push({ list });
    paragraph = null;
    list = null;
  };
  const closeSection = () => {
    closeBlock();
    const last = sections.at(-1);
    if (last && last.blocks.length === 0) fail(last.line, "empty_section");
  };
  const inlinesAt = (line: number, raw: string): ShownInline[] => {
    const result = parseInlines(raw);
    if (typeof result === "string") {
      fail(line, result);
      return [];
    }
    return result;
  };

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const text = rawLine.trim();
    const heading = HEADING.exec(text);

    if (text === "") {
      closeBlock();
    } else if (heading) {
      closeSection();
      const rest = heading[1]!;
      const explicit = EXPLICIT_ID.exec(rest);
      const title = readUntil(explicit ? explicit[1]! : rest, 0, null);
      if (!title) fail(line, "dangling_escape");
      const id = explicit ? explicit[2]! : slugOf(title?.value ?? "");
      if (!SECTION_ID.test(id)) fail(line, "invalid_section_id");
      else if (ids.has(id)) fail(line, "duplicate_section_id");
      ids.add(id);
      sections.push({ id, title: title?.value ?? "", blocks: [], line });
    } else if (text.startsWith("- ")) {
      const item = inlinesAt(line, text.slice(2));
      if (sections.length === 0) {
        short.push(item);
      } else {
        if (!list) closeBlock();
        list ??= [];
        list.push(item);
      }
    } else if (sections.length === 0) {
      fail(line, "text_before_first_section");
    } else {
      if (!paragraph) closeBlock();
      paragraph ??= [];
      paragraph.push(inlinesAt(line, text));
    }
  });
  closeSection();
  if (sections.length === 0) fail(null, "no_sections");

  if (errors.length > 0) {
    const order = (error: SourceError) => error.line ?? Infinity;
    return { ok: false, errors: errors.sort((a, b) => order(a) - order(b)) };
  }
  const parsed = parseConsentDocumentBody({
    short,
    sections: sections.map(({ id, title, blocks }) => ({ id, title, blocks })),
  });
  if (!parsed.ok) {
    return { ok: false, errors: [{ line: null, code: "invalid_document" }] };
  }
  return parsed;
}

function escapeText(text: string): string {
  return text.replace(/[\\*[\]{}]/g, (mark) => `\\${mark}`);
}

function formatInlines(text: ShownInline[]): string {
  return text
    .map((inline) => {
      if (typeof inline === "string") return escapeText(inline);
      if ("strong" in inline) return `**${escapeText(inline.strong)}**`;
      if ("fact" in inline) return `{{${inline.fact}}}`;
      return `[${escapeText(inline.link)}](${inline.href})`;
    })
    .join("");
}

function formatBlock(block: Block): string {
  if ("list" in block) {
    return block.list.map((item) => `- ${formatInlines(item)}`).join("\n");
  }
  const line = formatInlines(block.p);
  return /^[-#]/.test(line) ? `\\${line}` : line;
}

/** Writes a body as source, so staff start a new version from the last. */
export function formatConsentDocumentSource(body: ConsentDocumentBody): string {
  const chunks: string[] = [];
  if (body.short.length > 0) {
    chunks.push(
      body.short.map((point) => `- ${formatInlines(point)}`).join("\n")
    );
  }
  for (const section of body.sections) {
    const id = slugOf(section.title) === section.id ? "" : ` {#${section.id}}`;
    chunks.push(
      [
        `## ${escapeText(section.title)}${id}`,
        section.blocks.map(formatBlock).join("\n\n"),
      ].join("\n")
    );
  }
  return `${chunks.join("\n\n")}\n`;
}
