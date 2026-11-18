import type { ArticleBody, Block, Inline } from "./model";

/**
 * Plain-text helpers for articles: anchor ids and the table of contents,
 * word counts and reading time, and a Flesch-Kincaid estimate used by tests
 * to keep kids' articles at grade 6 or below (DIRECTION §1).
 */

/** Callout title that marks the adult-detail box in a kids' article. */
export const GROWN_UPS_TITLE = "For grown-ups";
/** Callout title of the closing actions box every article ends with. */
export const WHAT_YOU_CAN_DO_TITLE = "What you can do this week";

export function inlineText(text: Inline[]): string {
  return text
    .map((i) =>
      typeof i === "string"
        ? i
        : "em" in i
          ? i.em
          : "strong" in i
            ? i.strong
            : "link" in i
              ? i.link
              : ""
    )
    .join("");
}

function blockText(block: Block): string[] {
  switch (block.type) {
    case "paragraph":
      return [inlineText(block.text)];
    case "heading":
      return [block.text];
    case "list":
      return block.items.map(inlineText);
    case "callout":
      return [
        ...(block.title ? [block.title] : []),
        ...block.body.map(inlineText),
      ];
    case "sourceQuote":
      return [block.text];
    default:
      return [];
  }
}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** An anchor id for every heading block (undefined for other blocks). */
export function headingAnchors(blocks: Block[]): (string | undefined)[] {
  const seen = new Map<string, number>();
  return blocks.map((b) => {
    if (b.type !== "heading") return undefined;
    const base = slugify(b.text) || "section";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

export function tableOfContents(
  blocks: Block[]
): { id: string; text: string }[] {
  const ids = headingAnchors(blocks);
  return blocks.flatMap((b, i) =>
    b.type === "heading" && b.level === 2 ? [{ id: ids[i]!, text: b.text }] : []
  );
}

/** A meta description: whole sentences, at most `max` characters. */
export function metaDescription(text: string, max = 160): string {
  if (text.length <= max) return text;
  let out = "";
  for (const s of text.match(/[^.!?]+[.!?]+/g) ?? []) {
    const next = (out + s).trim();
    if (next.length > max) break;
    out = next + " ";
  }
  return out.trim() || `${text.slice(0, max - 1).trimEnd()}…`;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Words a reader reads in the body (images and bank quotes excluded). */
export function articleWords(body: ArticleBody): number {
  return words(body.blocks.flatMap(blockText).join("\n")).length;
}

export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

/** The text a child reads: everything except the grown-ups' box and quotes. */
export function kidText(body: ArticleBody): string {
  return body.blocks
    .filter(
      (b) =>
        b.type !== "sourceQuote" &&
        !(b.type === "callout" && b.title === GROWN_UPS_TITLE)
    )
    .flatMap(blockText)
    .join("\n");
}

export function countSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return /\d/.test(word) ? 2 : 0;
  if (w.length <= 3) return 1;
  w = w
    .replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  return Math.max(1, w.match(/[aeiouy]+/g)?.length ?? 0);
}

/** Flesch-Kincaid grade level. Lines (blocks) count as sentence breaks. */
export function fleschKincaidGrade(text: string): number {
  const sentences = text
    .split(/[.!?]+["”’)]*(?:\s+|$)|\n+/)
    .filter((s) => words(s).length > 0);
  const ws = words(text);
  if (ws.length === 0 || sentences.length === 0) return 0;
  const syllables = ws.reduce((n, w) => n + countSyllables(w), 0);
  return (
    0.39 * (ws.length / sentences.length) +
    11.8 * (syllables / ws.length) -
    15.59
  );
}
