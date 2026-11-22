// The bot screen's clock on a public form (#116): a form sent within
// MIN_FILL_MS of its human check being issued looks like a bot's, so the
// server answers as if it worked and keeps nothing. A person must never
// land there: one who fixes a field fast, or sends again after a refused
// check with a challenge fetched just then, would lose their report
// without knowing. So the form island waits out the rest of the clock
// before it posts.
//
// The island times the wait from when the challenge reached it, on its own
// monotonic clock: the server issued the challenge before then, so the
// server's clock has run at least as long, whatever either clock says.
//
// Pure, no imports: the server and the browser both load it.

/** A form sent sooner than this after its challenge is a bot's. */
export const MIN_FILL_MS = 3000;

/** Slack for the server's clock tick and rounding. */
const MARGIN_MS = 250;

/**
 * How long the island should still wait before posting a proof for a
 * challenge it received at `receivedAtMs` (both on `performance.now()`).
 */
export function fillWaitMs(receivedAtMs: number, nowMs: number): number {
  return Math.max(0, MIN_FILL_MS + MARGIN_MS - (nowMs - receivedAtMs));
}
