// The event status machine (#125). An event or campaign starts as a draft,
// is published for people to see and register for, and ends cancelled or
// completed. Edits to a published event (time, place, capacity) are not
// status changes; they notify registrants instead (./changes.ts).
//
// The `event_status` and `event_kind` enums in the schema are built from
// these lists. Every status exists from the start, so later work adds
// allowed moves here, never values to the enum (a value added and used in
// one migration run fails).
//
// Pure: no I/O, no "server-only", no `@/` imports.

export const EVENT_KINDS = ["event", "campaign"] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = [
  /** Being written. Only staff see it. */
  "draft",
  /** Listed on /events; people may register while registration is open. */
  "published",
  /** Called off, before or after publishing. Final. */
  "cancelled",
  /** Over: no-shows are settled and attendance is recorded. Final. */
  "completed",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export type EventTrigger = "created" | "published" | "cancelled" | "completed";

type Move = {
  /** null: the row is being created. */
  from: EventStatus | null;
  to: EventStatus;
  trigger: EventTrigger;
};

export const EVENT_MOVES: readonly Move[] = [
  { from: null, to: "draft", trigger: "created" },
  { from: "draft", to: "published", trigger: "published" },
  // A draft that will never run is cancelled, not deleted, so the audit
  // log and any links to it still resolve.
  { from: "draft", to: "cancelled", trigger: "cancelled" },
  { from: "published", to: "cancelled", trigger: "cancelled" },
  { from: "published", to: "completed", trigger: "completed" },
];

export class EventTransitionError extends Error {
  constructor(from: EventStatus | null, to: EventStatus) {
    super(`An event can't move from ${from ?? "(new)"} to ${to}`);
    this.name = "EventTransitionError";
  }
}

/** Whether the table allows an event to move from `from` to `to`. */
export function canMoveEvent(
  from: EventStatus | null,
  to: EventStatus
): boolean {
  return EVENT_MOVES.some((move) => move.from === from && move.to === to);
}

/** Returns `to`, or throws EventTransitionError for a forbidden move. */
export function moveEvent(
  from: EventStatus | null,
  to: EventStatus
): EventStatus {
  if (!canMoveEvent(from, to)) throw new EventTransitionError(from, to);
  return to;
}
