// Places and the waitlist (#125). An event has a capacity (or none, for
// unlimited places). Registering takes a place while one is left, else
// joins the waitlist, else is refused. A freed place, or a raised capacity,
// promotes the people waiting longest, in the same transaction that freed
// it, so nobody can register into a place someone is waiting for.
//
// The use case locks the event row, counts the places taken (registered
// and checked in) and the waitlist, and applies these rules; the order is
// the stored ordinal allocated in that transaction, independent of clock ties.
//
// Pure: no I/O, no "server-only", no `@/` imports.

export type Capacity = {
  /** null: unlimited places. */
  capacity: number | null;
  /** Registrations holding a place: registered or checked in. */
  placesTaken: number;
};

export type NewRegistrationPlace =
  | { status: "registered" | "waitlisted" }
  | { refused: "full" };

/**
 * Where a new registration goes. While anyone is waiting, newcomers join
 * the back of the line even if a place looks free: that place belongs to
 * the person waiting longest.
 */
export function placeForNewRegistration({
  capacity,
  placesTaken,
  waitlistEnabled,
  waiting = 0,
}: Capacity & {
  waitlistEnabled: boolean;
  /** People on the waitlist now. */
  waiting?: number;
}): NewRegistrationPlace {
  if (capacity === null) return { status: "registered" };
  if (placesTaken < capacity && waiting === 0) return { status: "registered" };
  return waitlistEnabled ? { status: "waitlisted" } : { refused: "full" };
}

export type WaitlistEntry = {
  id: string;
  waitlistedAt: Date;
  ordinal?: number;
};

/** The stored booking order; pure date-only callers break ties by id. */
export function orderWaitlist<E extends WaitlistEntry>(
  entries: readonly E[]
): E[] {
  return entries.toSorted(
    (a, b) =>
      (a.ordinal !== undefined && b.ordinal !== undefined
        ? a.ordinal - b.ordinal
        : 0) ||
      a.waitlistedAt.getTime() - b.waitlistedAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Ids to promote now, in order: as many people as there are free places.
 * Lowering capacity never demotes anyone; it only stops promotions until
 * enough places free up.
 */
export function planPromotions({
  capacity,
  placesTaken,
  waitlist,
}: Capacity & { waitlist: readonly WaitlistEntry[] }): string[] {
  const free =
    capacity === null ? waitlist.length : Math.max(0, capacity - placesTaken);
  return orderWaitlist(waitlist)
    .slice(0, free)
    .map((entry) => entry.id);
}

/** Someone's place in line, from 1; null if they aren't waiting. */
export function waitlistPosition(
  waitlist: readonly WaitlistEntry[],
  id: string
): number | null {
  const index = orderWaitlist(waitlist).findIndex((entry) => entry.id === id);
  return index === -1 ? null : index + 1;
}
