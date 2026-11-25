// Typed essays (#86): how the text is cleaned up, counted and limited. The
// essay form counts and checks as the participant types, and
// submitEssayText checks again; the text is then stored through the
// rich-text sanitiser's `essay` profile (src/server/rich-text/essay.ts) as
// paragraphs of plain text, which React shows as text, never markup.
//
// Words are counted as word processors count them, by gaps of whitespace,
// so the number a participant sees in their own editor matches ours. A
// token made only of punctuation (a dash, "...") isn't a word.
//
// Pure: no I/O, no "server-only", so the essay form can count as you type.

import {
  cleanEssayCharacters,
  ESSAY_MAX_CHARS,
} from "../../../rich-text/essay";

export type EssayRule = {
  maxWords: number;
  /** A backstop on length, whatever the word count says. */
  maxChars: number;
};

/** Until FOA sets its own (HR-37): 1500 words. */
export const DEFAULT_ESSAY_RULE: EssayRule = {
  maxWords: 1500,
  maxChars: ESSAY_MAX_CHARS,
};

const TRAILING_SPACE = /[^\S\n]+$/gm;
const EXTRA_BLANK_LINES = /\n{3,}/g;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The essay as it is stored: composed characters, `\n` line endings, no
 * control or direction-override characters, no trailing spaces, at most one
 * blank line between paragraphs, and trimmed.
 */
export function normaliseEssayText(text: string): string {
  return cleanEssayCharacters(text)
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
