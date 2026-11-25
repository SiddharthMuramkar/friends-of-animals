// The `essay` profile of the rich-text sanitiser (#86): a participant's
// typed essay. Like the other profiles (./blocks.ts, ./post-body.ts), an
// essay is never stored or rendered as HTML. It is paragraphs of lines of
// plain text, and React renders each line as a text node, so nothing a
// participant types can become markup: a typed `<script>` stays the
// characters they typed, shown as text.
//
// Unlike the other profiles it strips no markup. An essay is the
// participant's own words, judged as written, and the tag stripper
// (./strip-markup.ts) would take "a<b" or "<Bruno>" out of a sentence. The
// text is safe because of how it is stored and shown, not because anything
// was cut from it.
//
// Every save and every read passes through sanitizeEssayBody, and it never
// throws:
//
//   - only paragraphs of lines of strings survive; any other shape, key or
//     value is dropped;
//   - control characters go (a tab becomes a space), and so do direction
//     overrides and isolates, which can make text read differently from
//     how it is stored; joiners stay, because Indian scripts need them;
//   - trailing spaces, empty lines and empty paragraphs are dropped;
//   - at most ESSAY_MAX_CHARS characters are kept.
//
// Pure, relative imports only: the schema, the worker and the essay form
// load it.

/** A typed essay as stored: paragraphs, each a list of its lines. */
export type EssayBody = { paragraphs: string[][] };

/** A backstop on an essay's length, whatever its word count says. */
export const ESSAY_MAX_CHARS = 20_000;

// C0 and C1 control characters (Unicode category Cc) except tab and newline.
const CONTROL = /[^\P{Cc}\t\n]/gu;
// Embeddings, overrides and isolates (U+202A-U+202E, U+2066-U+2069),
// written as escapes so no invisible character sits in this file.
const BIDI_CONTROL = new RegExp("[\\u202a-\\u202e\\u2066-\\u2069]", "g");
const BYTE_ORDER_MARK = new RegExp("\\ufeff", "g");

/**
 * `text` with composed characters, `\n` line endings, tabs as spaces, and
 * no control, direction-override or byte-order-mark characters.
 */
export function cleanEssayCharacters(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL, "")
    .replace(BIDI_CONTROL, "")
    .replace(BYTE_ORDER_MARK, "");
}

/** One line as stored: clean, on one line, without trailing spaces. */
function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return cleanEssayCharacters(value).replace(/\n/g, " ").trimEnd();
}

/** The paragraphs and lines of `value` that fit the profile, in order. */
export function sanitizeEssayBody(value: unknown): EssayBody {
  const raw =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { paragraphs?: unknown }).paragraphs)
      ? (value as { paragraphs: unknown[] }).paragraphs
      : [];
  const paragraphs: string[][] = [];
  let budget = ESSAY_MAX_CHARS;
  for (const paragraph of raw) {
    if (!Array.isArray(paragraph) || budget <= 0) continue;
    const lines: string[] = [];
    for (const line of paragraph) {
      const clean = cleanLine(line).slice(0, budget);
      if (clean.trim() === "") continue;
      lines.push(clean);
      budget -= clean.length;
    }
    if (lines.length > 0) paragraphs.push(lines);
  }
  return { paragraphs };
}

/**
 * Typed text as an essay body: a blank line between paragraphs, a single
 * line break inside one. Sanitised before it is returned.
 */
export function essayBodyFromText(text: string): EssayBody {
  return sanitizeEssayBody({
    paragraphs: cleanEssayCharacters(text)
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.split("\n")),
  });
}

/** The essay as text again: what a replacement form starts from. */
export function essayBodyText(body: EssayBody): string {
  return body.paragraphs.map((lines) => lines.join("\n")).join("\n\n");
}
