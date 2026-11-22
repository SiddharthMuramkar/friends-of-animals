// Turns whatever a handler threw into the short text kept in
// `outbox.last_error`. Staff read it, and it may reach logs, so it should
// hold no personal data or secrets. Only the first line is kept (no stack,
// no payload dump), objects are never serialised, and what can be spotted
// is hidden: email addresses (percent-encoded too), phone numbers, bare
// numbers of four digits or more (one-time codes), URL query strings and
// fragments, and Bearer or Basic credentials. A name can't be spotted, so
// handlers must never throw messages with personal data in them
// (./handlers.ts).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

/** The longest description kept, in characters. */
export const MAX_FAILURE_LENGTH = 500;

// Every pattern below bounds its repeats, so redacting stays linear in the
// text's length: unbounded runs backtrack quadratically over a long word.
const EMAIL =
  /[^\s@<>()[\]"',;:]{1,64}@[^\s@<>()[\]"',;:]{1,253}\.[^\s@<>()[\]"',;:.]{1,63}/g;

// Ten or more digits, optionally with a leading + and spaces or dashes inside,
// standing alone: not part of an id such as a UUID's last group, which follows
// a dash, nor of a longer word.
const PHONE = /(?<![\w-])\+?\d[\d -]{8,30}\d(?![\w-])/g;

function digitsIn(text: string): number {
  return text.replaceAll(/\D/g, "").length;
}

// A URL's query string or fragment, where tokens and addresses travel.
const URL_QUERY = /(\bhttps?:\/\/[^\s?#]{0,2048})[?#]\S*/gi;

const CREDENTIAL = /\b(Bearer|Basic)\s{1,8}[\w.~+/=-]+/gi;

// Four or more digits standing alone, as a one-time code or a PIN does; a
// Postgres error code ("Postgres 23505", "SQLSTATE 40001") is kept.
const NUMBER = /(?<![\w-])(?<!(?:Postgres|SQLSTATE) )\d{4,}(?![\w-])/gi;

function redact(text: string): string {
  return text
    .replaceAll(/%40/gi, "@")
    .replaceAll(URL_QUERY, "$1?[query]")
    .replaceAll(CREDENTIAL, "$1 [credential]")
    .replaceAll(EMAIL, "[email]")
    .replaceAll(PHONE, (match) => (digitsIn(match) >= 10 ? "[phone]" : match))
    .replaceAll(NUMBER, "[number]");
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]!.trim();
}

function raw(error: unknown): string {
  if (error instanceof Error) {
    const message = firstLine(error.message);
    return message === "" ? error.name : `${error.name}: ${message}`;
  }
  if (typeof error === "string") return firstLine(error);
  return `Thrown value of type ${typeof error}`;
}

/** The most characters EMAIL matches: local part, "@", domain, ".", TLD. */
const LONGEST_ADDRESS = 64 + 1 + 253 + 1 + 63;

/**
 * How much of a message is redacted at all: a wide margin over
 * MAX_FAILURE_LENGTH, since a replacement can be shorter than what it hides.
 */
const REDACTED_LENGTH = 4 * MAX_FAILURE_LENGTH;

// What EMAIL and PHONE match is one unbroken run of these characters ("%40"
// included), so a cut where such a run stops splits neither.
const ADDRESS_CHARACTER = /[^\s<>()[\]"',;:]/;
const PHONE_CHARACTER = /[+\d -]/;

/**
 * Where to cut `text` instead of at `end`: at the start of the run of
 * `character`s that `end` splits, if the run has a `sign` ("@" or "%40" for
 * an address, a digit for a phone number) within LONGEST_ADDRESS characters
 * of `end`. Otherwise at `end`, as nothing redacted can straddle it.
 */
function cutOutside(
  text: string,
  end: number,
  character: RegExp,
  sign: RegExp
): number {
  const inRun = (index: number) => character.test(text.charAt(index));
  if (!inRun(end - 1) || !inRun(end)) return end;
  let start = end - 1;
  while (inRun(start - 1)) start--;
  let stop = end + 1;
  while (stop < end + LONGEST_ADDRESS && inRun(stop)) stop++;
  const near = text.slice(Math.max(start, end - LONGEST_ADDRESS), stop);
  return sign.test(near) ? start : end;
}

/**
 * The first REDACTED_LENGTH characters of `text`, or fewer: the cut moves
 * back until no address or phone number straddles it, since the part before
 * it would no longer be recognised and would be kept. A long word with
 * neither near the cut is cut where it is.
 */
function head(text: string): string {
  let end = Math.min(text.length, REDACTED_LENGTH);
  let previous: number;
  do {
    // Moving out of one kind of run can land inside the other.
    previous = end;
    end = cutOutside(text, end, ADDRESS_CHARACTER, /@|%40/);
    end = cutOutside(text, end, PHONE_CHARACTER, /\d/);
  } while (end !== previous);
  return text.slice(0, end);
}

/**
 * A one-line description of `error` with no email address or phone number in
 * it, at most MAX_FAILURE_LENGTH characters (cut with "…").
 */
export function describeFailure(error: unknown): string {
  // Redact before the final cut, so it never leaves part of an address
  // behind; only a bounded head is redacted, so this takes linear time.
  const text = raw(error);
  const kept = head(text);
  const described = redact(kept);
  return kept.length < text.length || described.length > MAX_FAILURE_LENGTH
    ? `${described.slice(0, MAX_FAILURE_LENGTH - 1)}…`
    : described;
}
