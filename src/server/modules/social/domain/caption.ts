// The words FOA posts with a queued item: the caption a content manager
// edits, and the credit line worked out from the consents each time the
// post is read. The caption is stored without the credit, so a credit that
// changes (a guardian withdraws the school opt-in) never lingers in it.
//
// The limit is Instagram's 2,200 for the whole post, caption and credit
// together. It is counted in code points: platforms count characters
// differently, and code points never count fewer than the graphemes a
// reader sees, so a post that fits here is not cut short there.
//
// The text cleaning matches the gallery's (gallery/domain/text.ts).
//
// Pure: loads under plain Node.

export const SOCIAL_POST_MAX = 2200;

/** Between the caption and the credit line. */
const CREDIT_SEPARATOR = "\n\n";

// Bidirectional embeddings, overrides and isolates: they can reverse how a
// line reads. Joiners (U+200C, U+200D) stay: Indic scripts and emoji need them.
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/g;
const LINE_BREAK = /\r\n|[\r\u2028\u2029]/g;
const HORIZONTAL_SPACE = /[^\S\n]+/g;

/** C0 and C1 controls and DEL, except the line feed. */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
}

/** How long a post is, as this module counts it: in code points. */
function lengthOf(text: string): number {
  return Array.from(text).length;
}

/**
 * NFC, no control or bidi characters, each line trimmed with single spaces,
 * at most one blank line between paragraphs.
 */
export function normaliseSocialCaption(input: string): string {
  const unified = input
    .normalize("NFC")
    .replace(LINE_BREAK, "\n")
    .replace(/\t/g, " ")
    .replace(BIDI_CONTROL, "");
  return Array.from(unified)
    .filter((char) => !isControl(char))
    .join("")
    .split("\n")
    .map((line) => line.replace(HORIZONTAL_SPACE, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The parts of a public credit (#82's resolver) a post shows. */
export type SocialCredit = { name: string; school?: string; city?: string };

/**
 * "Art by Asha K., Delhi Public School, Pune". The prefix is copy from the
 * messages; school and city appear only when the credit carries them.
 */
export function creditLine(credit: SocialCredit, prefix: string): string {
  const who = [credit.name, credit.school, credit.city]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return [prefix.trim(), who].filter(Boolean).join(" ");
}

export type SocialPost = {
  /** What a person pastes into the post. */
  text: string;
  length: number;
  /** The credit grew since the caption was saved: shorten the caption. */
  overLimit: boolean;
};

/** The post as it is copied or downloaded: caption, blank line, credit. */
export function composeSocialPost(parts: {
  caption: string;
  creditLine: string;
}): SocialPost {
  const text = [parts.caption, parts.creditLine]
    .filter(Boolean)
    .join(CREDIT_SEPARATOR);
  const length = lengthOf(text);
  return { text, length, overLimit: length > SOCIAL_POST_MAX };
}

export type SocialCaptionCheck =
  | { ok: true; value: string }
  | { ok: false; problem: "caption_empty" }
  | { ok: false; problem: "caption_too_long"; max: number };

/**
 * Normalises a caption and checks it leaves room for today's credit line.
 * `max` is the longest caption that fits with that credit.
 */
export function checkSocialCaption(
  input: string,
  line: string
): SocialCaptionCheck {
  const value = normaliseSocialCaption(input);
  if (value === "") return { ok: false, problem: "caption_empty" };
  const max =
    SOCIAL_POST_MAX - (line ? lengthOf(CREDIT_SEPARATOR) + lengthOf(line) : 0);
  if (lengthOf(value) > max) {
    return { ok: false, problem: "caption_too_long", max };
  }
  return { ok: true, value };
}
