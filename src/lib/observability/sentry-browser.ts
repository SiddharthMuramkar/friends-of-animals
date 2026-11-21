// The only parts of `@sentry/nextjs` the browser uses. Loading this module
// instead of the whole package lets the bundler leave replay, feedback and
// the rest of the SDK out of the lazy chunk (./browser.ts loads it on the
// first error). Every Sentry package declares `sideEffects: false`.

export { captureException, init } from "@sentry/nextjs";
