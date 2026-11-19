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
