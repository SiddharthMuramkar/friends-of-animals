// The wire protocol of ClamAV's clamd, as the scanner adapter speaks it over
// TCP (https://docs.clamav.net/manual/Usage/Scanning.html#clamd, and
// `man clamd`): send `zINSTREAM\0`, then the file as chunks each prefixed
// with its length in 4 big-endian bytes, then a zero-length chunk; clamd
// answers `stream: OK`, `stream: <signature> FOUND` or `<message> ERROR`,
// null-terminated. Pure functions only, so they are tested without a socket.

import type { ScanVerdict } from "./malware-scanner";

const encoder = new TextEncoder();

export const INSTREAM_COMMAND = encoder.encode("zINSTREAM\0");
export const PING_COMMAND = encoder.encode("zPING\0");

/** The zero-length chunk that ends an INSTREAM. */
export const END_OF_STREAM = new Uint8Array(4);

/** Chunks the adapter sends; well under clamd's StreamMaxLength. */
export const MAX_CHUNK_BYTES = 64 * 1024;

/** One INSTREAM chunk: its length (4 bytes, big-endian), then the bytes. */
export function frameChunk(chunk: Uint8Array): Uint8Array {
  if (chunk.length === 0) {
    throw new RangeError(
      "An empty chunk would end the stream early; send END_OF_STREAM instead"
    );
  }
  if (chunk.length > MAX_CHUNK_BYTES) {
    throw new RangeError(
      `Chunk of ${chunk.length} bytes is over ${MAX_CHUNK_BYTES}`
    );
  }
  const framed = new Uint8Array(4 + chunk.length);
  new DataView(framed.buffer).setUint32(0, chunk.length, false);
  framed.set(chunk, 4);
  return framed;
}

/** `data` in pieces of at most `MAX_CHUNK_BYTES`, without copying. */
export function* splitIntoChunks(data: Uint8Array): Generator<Uint8Array> {
  for (let start = 0; start < data.length; start += MAX_CHUNK_BYTES) {
    yield data.subarray(start, start + MAX_CHUNK_BYTES);
  }
}

/** The reply without its terminator and an optional `<id>: ` session prefix. */
function body(reply: string): string {
  return reply
    .replace(/[\0\n]+$/, "")
    .replace(/^\d+: /, "")
    .trim();
}

/**
 * What clamd's reply to an INSTREAM means. Anything unexpected is an error,
 * so a garbled reply can never pass a file.
 */
export function parseClamdReply(reply: string): ScanVerdict {
  const text = body(reply);
  if (text === "stream: OK") return { verdict: "clean" };
  const found = /^stream: (\S.*) FOUND$/.exec(text);
  if (found) return { verdict: "infected", signature: found[1]!.trim() };
  const error = /^(?:stream: )?(.*\S) ERROR$/.exec(text);
  if (error) return { verdict: "error", message: error[1]! };
  return {
    verdict: "error",
    message: `Unexpected clamd reply: ${JSON.stringify(text.slice(0, 200))}`,
  };
}

/** Whether `reply` is clamd's answer to PING (the sidecar healthcheck). */
export function isPong(reply: string): boolean {
  return body(reply) === "PONG";
}
