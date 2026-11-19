/** Pure text helpers for the kindness pledge card (no DOM, unit-tested). */

const MAX_NAME = 20;

/**
 * A first name or nickname only: letters and marks in any script, spaces,
 * hyphens and apostrophes; at most two words and 20 characters. Digits and
 * symbols are dropped so a phone number or email can't end up on the card.
 */
export function cleanName(raw: string): string {
  const letters = raw.normalize("NFC").replace(/[^\p{L}\p{M}\s'’-]/gu, "");
  const words = letters.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.join(" ").slice(0, MAX_NAME).trim();
}

/** Greedy word wrap for canvas text; a word wider than the line sits alone. */
export function wrapWords(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The pledge card's canvas: size, text column, type sizes and the logo. */
export const CARD = {
  width: 1080,
  height: 1350,
  /** Left edge of every text line. */
  x: 110,
  textWidth: 860,
  size: { lead: 64, promise: 92, pill: 38, quote: 38, source: 28 },
  pillHeight: 76,
  logo: {
    width: 280,
    height: (280 * 169.62) / 294.23,
    right: 110,
    bottom: 110,
  },
} as const;

/** Where the logo's top edge sits: the bottom block must end above it. */
export const LOGO_TOP = CARD.height - CARD.logo.bottom - CARD.logo.height;

const LEAD_TOP = 380;
const LEAD_STEP = 78;
const PROMISE_GAP = 30;
const PROMISE_STEP = 100;
const PILL_GAP = 10;
/** From the pill's bottom edge to the quote's baseline. */
const QUOTE_GAP = 70;
const SOURCE_STEP = 46;
/** The quote's resting baseline when the lines above leave room. */
const QUOTE_FLOOR = CARD.height - 400;

export type Line = { text: string; y: number };

export type CardLayout = {
  /** Baselines of the "{name} promises to" lines. */
  lead: Line[];
  /** Baselines of the promise lines. */
  promise: Line[];
  /** Top edge of the street-neighbour pill. */
  pillY: number;
  quoteY: number;
  sourceY: number;
};

/**
 * Vertical layout of the card. The lead, the promise and the pill run down
 * line by line; the quote and its source rest at a fixed baseline but move
 * down when a long name and a long promise push the pill into them.
 */
export function cardLayout(
  text: { lead: string; promise: string },
  measure: { lead: (s: string) => number; promise: (s: string) => number }
): CardLayout {
  let y = LEAD_TOP;
  const lines = (s: string, m: (s: string) => number, step: number) =>
    wrapWords(s, CARD.textWidth, m).map((line) => {
      const at = { text: line, y };
      y += step;
      return at;
    });

  const lead = lines(text.lead, measure.lead, LEAD_STEP);
  y += PROMISE_GAP;
  const promise = lines(text.promise, measure.promise, PROMISE_STEP);
  const pillY = y + PILL_GAP;
  const quoteY = Math.max(pillY + CARD.pillHeight + QUOTE_GAP, QUOTE_FLOOR);
  return { lead, promise, pillY, quoteY, sourceY: quoteY + SOURCE_STEP };
}
