// Which edits to a published event its registrants are told about (#125).
// A new time or place changes whether someone can come, so it sends a
// change notice; a reworded summary or a fixed typo doesn't. A moved start
// also moves the reminders, which count back from it.
//
// The update use case puts the result in the `event.changed` outbox payload,
// so the notice can say what changed without anyone diffing rows later.
//
// Pure: no I/O, no "server-only", no `@/` imports.

/** The fields a change notice is about. */
export type NoticeFields = {
  startsAt: Date;
  endsAt: Date;
  venueName: string | null;
  address: string | null;
  city: string | null;
  pinCode: string | null;
  onlineUrl: string | null;
};

export type NoticeChange = "time" | "place";

export type EventChanges = {
  /** What a change notice should mention, time first; empty: send none. */
  notice: NoticeChange[];
  /** True when reminders, which count back from the start, must move. */
  startMoved: boolean;
};

const PLACE_FIELDS = [
  "venueName",
  "address",
  "city",
  "pinCode",
  "onlineUrl",
] as const satisfies readonly (keyof NoticeFields)[];

const sameInstant = (a: Date, b: Date) => a.getTime() === b.getTime();

export function eventChanges(
  before: NoticeFields,
  after: NoticeFields
): EventChanges {
  const startMoved = !sameInstant(before.startsAt, after.startsAt);
  const timeChanged = startMoved || !sameInstant(before.endsAt, after.endsAt);
  const placeChanged = PLACE_FIELDS.some(
    (field) => before[field] !== after[field]
  );
  const notice: NoticeChange[] = [];
  if (timeChanged) notice.push("time");
  if (placeChanged) notice.push("place");
  return { notice, startMoved };
}
