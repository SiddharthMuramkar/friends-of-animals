// The server's error reporter as use cases see it (`deps.errors`). Next.js
// builds src/instrumentation.ts, where the reporter starts, apart from
// route handlers and server actions, so they don't share module state.
// The started reporter is kept on globalThis instead, as the Sentry SDK
// keeps its own client, and `serverErrorReporter` reports through it.

import { silentErrorReporter, type ErrorReporter } from "@/server/ports/errors";

/** Makes `reporter` the one `serverErrorReporter` reports through. */
export function useServerErrorReporter(_reporter: ErrorReporter): void {}

/** Reports through the reporter the server started; silent until then. */
export const serverErrorReporter: ErrorReporter = silentErrorReporter;
