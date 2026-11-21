// Typed essays: how the text is cleaned up, counted, limited and turned
// into the paragraphs the rich-text sanitiser receives.
//
// A participant types plain text. Nothing they type ever becomes markup:
// every character is escaped here, and the sanitiser then checks the
// paragraphs again before anything is stored or shown.
//
// Words are counted as word processors count them, by gaps of whitespace,
// so the number a participant sees in their own editor matches ours. A
// token made only of punctuation (a dash, "...") isn't a word.
//
// Pure: no I/O, no "server-only", so the essay form can count as you type.

export type EssayRule = {
  maxWords: number;
  /** A backstop on length, whatever the word count says. */
  maxChars: number;
};

/** Until FOA sets its own: 1500 words. */
export const DEFAULT_ESSAY_RULE: EssayRule = {
  maxWords: 1500,
  maxChars: 20_000,
};

// C0 and C1 control characters (Unicode category Cc) except tab and newline.
const CONTROL = /[^\P{Cc}\t\n]/gu;
// Embeddings, overrides and isolates: they can make text read differently
// from how it is stored. Joiners (U+200C, U+200D) stay: Indian scripts need them.
const BIDI_CONTROL = /[‪-‮⁦-⁩]/g;
const BYTE_ORDER_MARK = /﻿/g;
const TRAILING_SPACE = /[^\S\n]+$/gm;
const EXTRA_BLANK_LINES = /\n{3,}/g;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The essay as it is stored: composed characters, `\n` line endings, no
 * control or direction-override characters, no trailing spaces, at most one
 * blank line between paragraphs, and trimmed.
 */
export function normaliseEssayText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL, "")
    .replace(BIDI_CONTROL, "")
    .replace(BYTE_ORDER_MARK, "")
    .replace(TRAILING_SPACE, "")
    .replace(EXTRA_BLANK_LINES, "\n\n")
    .trim();
}

/** The number of words: whitespace-separated runs with a letter or digit. */
export function countWords(text: string): number {
  let count = 0;
  for (const token of text.split(/\s+/)) {
    if (HAS_LETTER_OR_DIGIT.test(token)) count += 1;
  }
  return count;
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

/**
 * Normalised essay text as HTML: one `<p>` per paragraph (paragraphs are
 * separated by a blank line), `<br>` for a single line break, and every
 * character escaped. The result still goes through the sanitiser.
 */
export function essayTextToHtml(normalised: string): string {
  if (normalised === "") return "";
  return normalised
    .split("\n\n")
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

export type EssayCheck =
  | { ok: true; text: string; wordCount: number }
  | {
      ok: false;
      reason: "empty" | "too_many_words" | "too_long";
      wordCount: number;
    };

/**
 * Normalises a typed essay and checks it against `rule`: it needs at least
 * one word, at most `maxWords`, and at most `maxChars` characters once
 * normalised. The same check runs in the form and on the server.
 */
export function checkEssayText(text: string, rule: EssayRule): EssayCheck {
  const normalised = normaliseEssayText(text);
  const wordCount = countWords(normalised);
  if (wordCount === 0) return { ok: false, reason: "empty", wordCount };
  if (normalised.length > rule.maxChars) {
    return { ok: false, reason: "too_long", wordCount };
  }
  if (wordCount > rule.maxWords) {
    return { ok: false, reason: "too_many_words", wordCount };
  }
  return { ok: true, text: normalised, wordCount };
}
