// The one length rule for videos, shared by the upload form (which reads
// the length in the browser when it can), the upload use case and the
// media worker (which reads it with ffprobe). Phones stop a little after
// the button is pressed, so a "3 minute" clip may run a fraction over;
// a second of slack keeps the browser and the worker from disagreeing.
//
// Pure and dependency-free, so the upload form can import it.

export const DURATION_TOLERANCE_MS = 1_000;

/** Whether a clip is too long. A length nobody could read isn't. */
export function isOverDuration(
  durationMs: number | null,
  maxDurationMs: number
): boolean {
  return (
    durationMs !== null && durationMs > maxDurationMs + DURATION_TOLERANCE_MS
  );
}
