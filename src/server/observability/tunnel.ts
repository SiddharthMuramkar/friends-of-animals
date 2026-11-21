// The same-origin Sentry tunnel (#66), served at POST /monitoring. The
// browser SDK posts its envelopes here instead of to Sentry, so the
// Content Security Policy keeps `connect-src 'self'` (#65). What may go on
// is decided by `tunnelEnvelope` (src/lib/observability/envelope.ts); this
// is the HTTP half: off without a DSN, size limit, forwarding.
//
// Nothing about the visitor is forwarded: no IP, no cookies, no headers.
// There is no rate limit here; Sentry's spike protection covers it (HR-22).

import { parseDsn } from "@/lib/observability/config";
import {
  DEFAULT_MAX_ENVELOPE_BYTES,
  tunnelEnvelope,
} from "@/lib/observability/envelope";

export type TunnelInput = {
  /** NEXT_PUBLIC_SENTRY_DSN; unset makes the route answer 404. */
  dsn: string | undefined;
  /** The server's APP_ENV, which replaces whatever the browser sent. */
  environment: string;
  /** Defaults to the global fetch; tests pass a stub. */
  fetch?: typeof fetch;
  /** Defaults to 1 MiB (DEFAULT_MAX_ENVELOPE_BYTES). */
  maxBytes?: number;
};

/** How long Sentry gets to accept an envelope. */
const FORWARD_TIMEOUT_MS = 5000;

/** Sentry's answers the browser SDK reads to back off. */
const RATE_LIMIT_HEADERS = ["retry-after", "x-sentry-rate-limits"] as const;

const answer = (status: number, headers?: Record<string, string>) =>
  new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

/**
 * The request body, or undefined once it is over `maxBytes`: refused by
 * its Content-Length before reading, or as soon as it grows past it.
 */
async function readBody(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | undefined> {
  const stated = Number(request.headers.get("content-length") ?? 0);
  if (stated > maxBytes) return undefined;
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/** Answers one browser envelope. */
export async function handleTunnelRequest(
  request: Request,
  {
    dsn,
    environment,
    fetch: send = fetch,
    maxBytes = DEFAULT_MAX_ENVELOPE_BYTES,
  }: TunnelInput
): Promise<Response> {
  const ours = dsn ? parseDsn(dsn) : undefined;
  if (ours === undefined) return answer(404);

  const body = await readBody(request, maxBytes);
  if (body === undefined) return answer(413);

  const decision = tunnelEnvelope(body, { dsn: ours, environment, maxBytes });
  if (decision.kind === "reject") return answer(decision.status);
  if (decision.kind === "drop") return answer(200);

  let upstream: Response;
  try {
    upstream = await send(decision.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: decision.body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch {
    return answer(502);
  }
  const passed: Record<string, string> = {};
  for (const name of RATE_LIMIT_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) passed[name] = value;
  }
  return answer(upstream.status, passed);
}
