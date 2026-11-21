import type { Instrumentation } from "next";

/**
 * Next.js calls `register` once when a server instance starts, before it
 * serves a request: `next start`, the standalone server, `next dev`, and each
 * Vercel Function instance. `next build` doesn't call it (checked on Next
 * 16.4), so the build still needs no database.
 */
export async function register() {
  // The Node.js-only half lives in its own module so the Edge build of this
  // file never sees Node APIs.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrExit, errorReporter } =
      await import("./instrumentation-node");
    validateEnvOrExit();
    await errorReporter();
  }
}

/**
 * Next.js calls this for every error it catches on the server: in a page,
 * a route handler, a server action or the proxy. The error goes to Sentry,
 * scrubbed, with the route but without the request's headers (#66).
 */
export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onRequestError } = await import("./instrumentation-node");
    await onRequestError(...args);
  }
};
