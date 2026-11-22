// Fixed windows for the public forms' rate limits (#113): each counter
// counts within a window that starts on a multiple of its length since
// the Unix epoch, so every instance agrees on the window without
// coordinating. Day windows therefore turn over at midnight UTC, which is
// 05:30 in India. The cost, as with #57's sign-in limiter: a sender who
// times it can get up to twice a limit through across a boundary (5 at
// 10:59:59 and 5 more at 11:00:01). A sliding window would close that, at
// the price of a row per attempt. Shared by the contact form and the later
// public forms (#116 safeguarding reports, #106 receipt links, #125, #134).
//
// Loads under plain Node, so no "server-only" here.

export type RateWindow = { start: Date; end: Date };

/** The window of length `windowMs` that contains `now`. */
export function fixedWindow(now: Date, windowMs: number): RateWindow {
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new RangeError(
      `A rate-limit window is a positive whole number of ms, not ${windowMs}`
    );
  }
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  return { start: new Date(start), end: new Date(start + windowMs) };
}

/**
 * When a sender refused by `windows` may try again: once the last of them
 * has ended. Seconds round up, for a Retry-After header.
 */
export function latestRetry(
  now: Date,
  windows: readonly RateWindow[]
): { retryAfter: Date; retryAfterSeconds: number } {
  if (windows.length === 0) {
    throw new RangeError("latestRetry needs the windows that refused");
  }
  const end = Math.max(...windows.map((window) => window.end.getTime()));
  return {
    retryAfter: new Date(end),
    retryAfterSeconds: Math.ceil((end - now.getTime()) / 1000),
  };
}
