// Strips HTML-like markup from one run of text. Rich text on this platform
// is stored as typed blocks (see ./blocks.ts) and rendered as React text
// nodes, which escape everything, so markup in a string can never run.
// Stripping it anyway means a pasted `<script>` or `onerror=` never reaches
// the database or the page at all.
//
// It follows the HTML tokenizer where that matters: a tag ends at the first
// `>` outside a quoted attribute value, a tag still open at the end is
// dropped, and script-like elements go with their content. It repeats until
// nothing changes, so the pieces of a nested tag can't form a new one.
//
// Loads under plain Node (schema, seed): no imports at all.

/** Elements dropped together with everything inside them. */
const DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "noscript",
  "template",
  "svg",
  "math",
  "textarea",
  "title",
  "xmp",
  "noembed",
  "noframes",
  "select",
]);

/**
 * C0 controls except tab, line feed and carriage return; DEL; and the
 * bidirectional embeddings, overrides and isolates (U+202A to U+202E,
 * U+2066 to U+2069), which can make text read differently from what it is.
 * Checked by code point so no invisible character sits in this file.
 */
export function isInvisibleControl(codePoint: number): boolean {
  return (
    (codePoint <= 0x1f &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d) ||
    codePoint === 0x7f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function withoutInvisibleControls(text: string): string {
  let out = "";
  for (const char of text) {
    if (!isInvisibleControl(char.codePointAt(0)!)) out += char;
  }
  return out;
}

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z]$/.test(char);
}

/**
 * Where the tag starting at `from` (just after `<` or `</`) ends: the index
 * of its closing `>`, or -1 if it never closes.
 */
function tagEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const char = text[i];
    if (char === ">") return i;
    i += 1;
    if (char !== "=") continue;
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    const quote = text[i];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, i + 1);
      if (close === -1) return -1;
      i = close + 1;
    }
  }
  return -1;
}

function tagName(text: string, from: number): string {
  const match = /^[A-Za-z][^\s/>]*/.exec(text.slice(from));
  return (match?.[0] ?? "").toLowerCase();
}

/** The index just past `</name ...>` at or after `from`, or -1. */
function afterClosingTag(text: string, name: string, from: number): number {
  const closing = new RegExp(`</${name}(?=[\\s/>])`, "gi");
  closing.lastIndex = from;
  const match = closing.exec(text);
  if (!match) return -1;
  const end = text.indexOf(">", match.index);
  return end === -1 ? -1 : end + 1;
}

/** One left-to-right pass. Returns early when the rest is to be dropped. */
function stripOnce(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open === -1) return out + text.slice(i);
    out += text.slice(i, open);
    const next = text[open + 1];

    if (text.startsWith("<!--", open)) {
      const end = text.indexOf("-->", open + 4);
      if (end === -1) return out;
      i = end + 3;
    } else if (next === "!" || next === "?") {
      const end = text.indexOf(">", open + 2);
      if (end === -1) return out;
      i = end + 1;
    } else if (next === "/") {
      const end = isAsciiLetter(text[open + 2])
        ? tagEnd(text, open + 2)
        : text.indexOf(">", open + 2);
      if (end === -1) return out;
      i = end + 1;
    } else if (isAsciiLetter(next)) {
      const name = tagName(text, open + 1);
      const end = tagEnd(text, open + 1);
      if (end === -1 || name === "plaintext") return out;
      if (DROPPED_WITH_CONTENT.has(name)) {
        const after = afterClosingTag(text, name, end + 1);
        if (after === -1) return out;
        i = after;
      } else {
        i = end + 1;
      }
    } else {
      // "<" before a space, digit or the end is text, as in "I <3 dogs".
      out += "<";
      i = open + 1;
    }
  }
  return out;
}

/**
 * `text` without tags, comments, script-like elements or invisible control
 * characters. Text between tags, spacing and entity references are kept as
 * typed. Idempotent.
 */
export function stripMarkup(text: string): string {
  let current = withoutInvisibleControls(text);
  // Every pass that changes the text makes it shorter, so this ends.
  for (;;) {
    const next = stripOnce(current);
    if (next === current) return current;
    current = next;
  }
}
