// Anti-sniping: a bid in the last minutes of a lot pushes its close back,
// so nobody wins by bidding in the final second. A bid placed strictly
// inside the window (after `closesAt - window`, before `closesAt`) moves the
// close to `closesAt + window`: the closing time is extended by the
// configured window, as the ticket words it. Each extension needs a higher
// bid, so a lot always closes. A window of 0 turns anti-sniping off.
//
// Pure; no imports. The window comes from the `auctions.antiSnipingWindowMinutes`
// setting and times from the injected clock.

const MINUTE_MS = 60_000;

export type CloseAfterBid = { closesAt: Date; extended: boolean };

/** When the lot closes once a bid placed at `placedAt` is accepted. */
export function closeAfterBid(input: {
  closesAt: Date;
  placedAt: Date;
  windowMinutes: number;
}): CloseAfterBid {
  const { closesAt, placedAt, windowMinutes } = input;
  if (!Number.isInteger(windowMinutes) || windowMinutes < 0) {
    throw new RangeError(
      `The anti-sniping window must be a whole number of minutes, 0 or more; got ${windowMinutes}`
    );
  }
  const windowMs = windowMinutes * MINUTE_MS;
  const close = closesAt.getTime();
  const placed = placedAt.getTime();
  const insideWindow = placed > close - windowMs && placed < close;
  if (windowMs === 0 || !insideWindow) {
    return { closesAt, extended: false };
  }
  return { closesAt: new Date(close + windowMs), extended: true };
}

export type CloseDue = { kind: "close" } | { kind: "reschedule"; at: Date };

/**
 * What the lot's close job does when it runs at `now`. The job is queued
 * for the close time the lot had when it was scheduled; a later bid may
 * have extended it since, and then the job queues itself again for the
 * new time instead of closing the lot.
 */
export function closeDue(closesAt: Date, now: Date): CloseDue {
  return now.getTime() < closesAt.getTime()
    ? { kind: "reschedule", at: closesAt }
    : { kind: "close" };
}
