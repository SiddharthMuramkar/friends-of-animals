// The server's error reporter as use cases see it (`deps.errors`). Next.js
// builds src/instrumentation.ts, where the reporter starts, apart from
// route handlers and server actions, so they don't share module state.
// The started reporter is kept on globalThis instead, as the Sentry SDK
// keeps its own client, and `serverErrorReporter` reports through it.

import { silentErrorReporter, type ErrorReporter } from "@/server/ports/errors";

const KEY = Symbol.for("foa.serverErrorReporter");

type Holder = { [KEY]?: ErrorReporter };

const started = (): ErrorReporter =>
  (globalThis as Holder)[KEY] ?? silentErrorReporter;

/** Makes `reporter` the one `serverErrorReporter` reports through. */
export function useServerErrorReporter(reporter: ErrorReporter): void {
  (globalThis as Holder)[KEY] = reporter;
}

/** Reports through the reporter the server started; silent until then. */
export const serverErrorReporter: ErrorReporter = {
  report: (error, context) => started().report(error, context),
  flush: (timeoutMs) => started().flush(timeoutMs),
};
