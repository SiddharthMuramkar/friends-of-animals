// The words a content manager writes for a gallery item: its title and a
// short story. Stored as plain text (no markup, so nothing to sanitise),
// normalised once on save so the public pages and the limits agree.
//
// Limits count graphemes, the characters a reader sees, so a Devanagari
// title is held to the same 120 as a Latin one.
//
// Pure: loads under plain Node.

export const GALLERY_TEXT_LIMITS = {
  titleMax: 120,
  storyMax: 500,
} as const;

export type GalleryTextResult<Problem extends string> =
  | { ok: true; value: string }
  | { ok: false; problem: Problem };

// Bidirectional embeddings, overrides and isolates: they can reverse how a
// title reads. Joiners (U+200C, U+200D) stay: Indic scripts and emoji need them.
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/g;
const LINE_BREAK = /\r\n|[\r\u2028\u2029]/g;
const HORIZONTAL_SPACE = /[^\S\n]+/g;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The number of user-perceived characters in `text`. */
export function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

/** C0 and C1 controls and DEL, except the line feed. */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
}

/** NFC, line breaks as "\n", tabs as spaces, no control characters. */
function clean(text: string): string {
  const unified = text
    .normalize("NFC")
    .replace(LINE_BREAK, "\n")
    .replace(/\t/g, " ")
    .replace(BIDI_CONTROL, "");
  return Array.from(unified)
    .filter((char) => !isControl(char))
    .join("");
}

/** One line: trimmed, every run of whitespace a single space, 1–120 long. */
export function normaliseGalleryTitle(
  input: string
): GalleryTextResult<"title_empty" | "title_too_long"> {
  const value = clean(input).replace(/\s+/g, " ").trim();
  if (value === "") return { ok: false, problem: "title_empty" };
  if (graphemeCount(value) > GALLERY_TEXT_LIMITS.titleMax) {
    return { ok: false, problem: "title_too_long" };
  }
  return { ok: true, value };
}

/**
 * Paragraphs: each line trimmed with single spaces, at most one blank line
 * between paragraphs, 0–500 long.
 */
export function normaliseGalleryStory(
  input: string
): GalleryTextResult<"story_too_long"> {
  const value = clean(input)
    .split("\n")
    .map((line) => line.replace(HORIZONTAL_SPACE, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (graphemeCount(value) > GALLERY_TEXT_LIMITS.storyMax) {
    return { ok: false, problem: "story_too_long" };
  }
  return { ok: true, value };
}
