// Runs in the browser before the app hydrates (Next.js
// instrumentation-client convention). Error tracking adds two listeners
// here and loads the Sentry SDK only on the first error, through the
// same-origin /monitoring tunnel (#66). Without NEXT_PUBLIC_SENTRY_DSN at
// build time it does nothing.

import { startBrowserErrorTracking } from "./lib/observability/browser";

try {
  startBrowserErrorTracking({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    target: window,
    loadSdk: () => import("./lib/observability/sentry-browser"),
  });
} catch {
  // Monitoring must never stop the page from starting.
}
