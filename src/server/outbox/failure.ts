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

const EMAIL = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[^\s@<>()[\]"',;:.]+/g;

// Ten or more digits, optionally with a leading + and spaces or dashes inside,
// standing alone: not part of an id such as a UUID's last group, which follows
// a dash, nor of a longer word.
const PHONE = /(?<![\w-])\+?\d[\d -]{8,}\d(?![\w-])/g;

function digitsIn(text: string): number {
  return text.replaceAll(/\D/g, "").length;
}

// A URL's query string or fragment, where tokens and addresses travel.
const URL_QUERY = /(\bhttps?:\/\/[^\s?#]*)[?#]\S*/gi;

const CREDENTIAL = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi;

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

/**
 * A one-line description of `error` with no email address or phone number in
 * it, at most MAX_FAILURE_LENGTH characters (cut with "…").
 */
export function describeFailure(error: unknown): string {
  // Redact before cutting, so a cut never leaves part of an address behind.
  const described = redact(raw(error));
  return described.length > MAX_FAILURE_LENGTH
    ? `${described.slice(0, MAX_FAILURE_LENGTH - 1)}…`
    : described;
}
