// The pure half of the same-origin Sentry tunnel (#66). The browser SDK
// posts its envelopes to our own route instead of Sentry's host, so the
// Content Security Policy keeps `connect-src 'self'` (#65). The route hands
// the body to `tunnelEnvelope`, which decides what may go on to Sentry:
//
//   - only envelopes for our own project, key and host (no open relay);
//   - only error events, transactions and client reports; sessions,
//     replays, feedback, attachments and anything newer are dropped;
//   - every event scrubbed again on the server (a browser can't be
//     trusted to have run the scrubber) and tagged with the server's
//     APP_ENV, whatever the browser claimed;
//   - the user removed from the trace header.
//
// Envelope format: https://develop.sentry.dev/sdk/data-model/envelopes/
// A JSON header line, then items: a JSON item header line, then a payload
// that is either `length` bytes or runs to the next newline.

import type { Dsn } from "./config";
import { parseDsn } from "./config";
import {
  isRecord,
  redactText,
  scrubEvent,
  stripQuery,
  type ScrubOptions,
} from "./scrub";

/** Sentry's limit for one event; larger envelopes are refused unread. */
export const DEFAULT_MAX_ENVELOPE_BYTES = 1024 * 1024;

/** Items scrubbed with `scrubEvent` and tagged with the environment. */
const EVENT_ITEMS: ReadonlySet<string> = new Set(["event", "transaction"]);

/** Items that carry only counts, forwarded as they are. */
const COUNT_ITEMS: ReadonlySet<string> = new Set(["client_report"]);

/** Trace-header fields that identify the user or a dropped replay. */
const TRACE_USER_FIELDS = ["user_id", "user_segment", "replay_id"] as const;

const NEWLINE = 0x0a;

/** The URL Sentry takes envelopes at for the DSN's project. */
export function envelopeUrl(dsn: Dsn): string {
  return `${dsn.protocol}://${dsn.host}${dsn.path}/api/${dsn.projectId}/envelope/`;
}

export type TunnelOptions = ScrubOptions & {
  /** The DSN the server was configured with; envelopes must match it. */
  dsn: Dsn;
  /** The server's APP_ENV, which replaces whatever the browser sent. */
  environment: string;
  /** Defaults to DEFAULT_MAX_ENVELOPE_BYTES. */
  maxBytes?: number;
};

export type TunnelDecision =
  /** Post `body` to `url` with Content-Type application/x-sentry-envelope. */
  | { kind: "forward"; url: string; body: Uint8Array<ArrayBuffer> }
  /** Nothing in the envelope may go on; answer 200 and send nothing. */
  | { kind: "drop" }
  /** Answer `status` and send nothing. */
  | {
      kind: "reject";
      status: 400 | 413;
      reason: "size" | "malformed" | "dsn";
    };

type Item = { header: Record<string, unknown>; payload: Uint8Array };

class MalformedEnvelope extends Error {}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/**
 * How deeply an envelope line's JSON may nest. Real events stay far below
 * it; deeper ones are refused before parsing, so no runtime's stack depth
 * decides whether scrubbing and re-serialising them can fail.
 */
const MAX_JSON_DEPTH = 64;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPENERS: ReadonlySet<number> = new Set([0x5b, 0x7b]); // [ {
const CLOSERS: ReadonlySet<number> = new Set([0x5d, 0x7d]); // ] }

/**
 * Whether JSON text nests deeper than MAX_JSON_DEPTH. It scans the UTF-8
 * bytes: brackets and quotes are ASCII, and no multi-byte character
 * contains an ASCII byte.
 */
function nestsTooDeep(bytes: Uint8Array): boolean {
  let depth = 0;
  let inString = false;
  for (let at = 0; at < bytes.byteLength; at++) {
    const byte = bytes[at]!;
    if (inString) {
      if (byte === BACKSLASH) at++;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) {
      inString = true;
    } else if (OPENERS.has(byte)) {
      depth++;
      if (depth > MAX_JSON_DEPTH) return true;
    } else if (CLOSERS.has(byte)) {
      depth--;
    }
  }
  return false;
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  if (nestsTooDeep(bytes)) throw new MalformedEnvelope();
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new MalformedEnvelope();
  }
  if (!isRecord(value)) throw new MalformedEnvelope();
  return value;
}

/** The bytes from `start` to the next newline (or the end), and what follows. */
function readLine(body: Uint8Array, start: number) {
  const end = body.indexOf(NEWLINE, start);
  return end === -1
    ? { line: body.subarray(start), next: body.byteLength }
    : { line: body.subarray(start, end), next: end + 1 };
}

function parseEnvelope(body: Uint8Array) {
  if (body.byteLength === 0) throw new MalformedEnvelope();
  const first = readLine(body, 0);
  const header = parseJsonObject(first.line);
  const items: Item[] = [];
  let at = first.next;
  while (at < body.byteLength) {
    const headerLine = readLine(body, at);
    const itemHeader = parseJsonObject(headerLine.line);
    if (typeof itemHeader.type !== "string") throw new MalformedEnvelope();
    at = headerLine.next;

    const { length } = itemHeader;
    if (length === undefined) {
      const payloadLine = readLine(body, at);
      items.push({ header: itemHeader, payload: payloadLine.line });
      at = payloadLine.next;
      continue;
    }
    if (
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 0 ||
      at + length > body.byteLength
    ) {
      throw new MalformedEnvelope();
    }
    items.push({ header: itemHeader, payload: body.subarray(at, at + length) });
    at += length;
    if (body[at] === NEWLINE) at += 1;
  }
  return { header, items };
}

function sameProject(claimed: unknown, ours: Dsn): boolean {
  if (typeof claimed !== "string") return false;
  const dsn = parseDsn(claimed);
  return (
    dsn !== undefined &&
    dsn.publicKey === ours.publicKey &&
    dsn.host === ours.host &&
    dsn.path === ours.path &&
    dsn.projectId === ours.projectId
  );
}

function scrubTraceHeader(
  trace: Record<string, unknown>,
  environment: string
): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = { ...trace, environment };
  for (const field of TRACE_USER_FIELDS) delete scrubbed[field];
  if (typeof scrubbed.transaction === "string") {
    scrubbed.transaction = redactText(stripQuery(scrubbed.transaction));
  }
  return scrubbed;
}

/** The item as it goes on, or undefined when it is dropped. */
function forwardItem(item: Item, options: TunnelOptions): string[] | undefined {
  const type = String(item.header.type);
  let payload: Record<string, unknown>;
  if (EVENT_ITEMS.has(type)) {
    payload = {
      ...scrubEvent(parseJsonObject(item.payload), options),
      environment: options.environment,
    };
  } else if (COUNT_ITEMS.has(type)) {
    payload = parseJsonObject(item.payload);
  } else {
    return undefined;
  }
  const text = JSON.stringify(payload);
  const header = { ...item.header, length: encoder.encode(text).byteLength };
  return [JSON.stringify(header), text];
}

/** What to do with one envelope the browser posted to the tunnel. */
export function tunnelEnvelope(
  body: Uint8Array,
  options: TunnelOptions
): TunnelDecision {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ENVELOPE_BYTES;
  if (body.byteLength > maxBytes) {
    return { kind: "reject", status: 413, reason: "size" };
  }

  let lines: string[];
  try {
    const envelope = parseEnvelope(body);
    if (!sameProject(envelope.header.dsn, options.dsn)) {
      return { kind: "reject", status: 400, reason: "dsn" };
    }
    const header = isRecord(envelope.header.trace)
      ? {
          ...envelope.header,
          trace: scrubTraceHeader(envelope.header.trace, options.environment),
        }
      : envelope.header;
    lines = envelope.items.flatMap((item) => forwardItem(item, options) ?? []);
    if (lines.length === 0) return { kind: "drop" };
    lines.unshift(JSON.stringify(header));
  } catch {
    // MalformedEnvelope, or anything the browser's JSON makes the parser,
    // scrubber or serialiser throw (e.g. a RangeError on an event nested
    // 200,000 deep). Either way the input is at fault: a 400, not a 500.
    return { kind: "reject", status: 400, reason: "malformed" };
  }

  return {
    kind: "forward",
    url: envelopeUrl(options.dsn),
    body: encoder.encode(lines.join("\n")),
  };
}
