// Errors caught by our error boundaries (src/app/error.tsx and
// global-error.tsx). Next.js only logs those in production, so they would
// never reach Sentry; reporting them as uncaught errors lets the browser
// tracker (./browser.ts) or the SDK's own handlers pick them up.

/**
 * Reports an error a boundary caught. Server errors carry a digest and
 * were already reported by the server (src/instrumentation.ts), with
 * their real message, so they are only logged.
 */
export function reportBoundaryError(
  error: unknown,
  report: (error: unknown) => void = globalThis.reportError
): void {
  const fromServer =
    typeof error === "object" && error !== null && "digest" in error;
  if (fromServer) console.error(error);
  // reportError logs it too, as an uncaught error.
  else report(error);
}
