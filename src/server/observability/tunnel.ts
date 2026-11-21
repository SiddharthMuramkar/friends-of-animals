// The same-origin Sentry tunnel (#66), served at POST /monitoring. The
// browser SDK posts its envelopes here instead of to Sentry, so the
// Content Security Policy keeps `connect-src 'self'` (#65). What may go on
// is decided by `tunnelEnvelope` (src/lib/observability/envelope.ts); this
// is the HTTP half: off without a DSN, size limit, forwarding.

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

/** Answers one browser envelope. */
export async function handleTunnelRequest(
  _request: Request,
  _input: TunnelInput
): Promise<Response> {
  return new Response(null, { status: 500 });
}
