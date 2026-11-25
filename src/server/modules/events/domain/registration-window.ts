// When people may register for an event (#125). Staff may set an opening
// and a closing time; without them registration opens when the event is
// published and closes when it starts. The public page shows the state and
// the registration use case (125b) refuses outside the window.
//
// Pure: no I/O, no "server-only", no `@/` imports.

import type { EventStatus } from "./event-status";

export type RegistrationWindowEvent = {
  status: EventStatus;
  /** Set when the event is published. */
  publishedAt: Date | null;
  startsAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
};

export type RegistrationWindow =
  /** Not published, or cancelled or completed: nobody may register. */
  | { state: "unavailable" }
  | {
      state: "not_open_yet" | "open" | "closed";
      opensAt: Date;
      closesAt: Date;
    };

/** The window at `now`: open from `opensAt` (inclusive) to `closesAt`. */
export function registrationWindow(
  event: RegistrationWindowEvent,
  now: Date
): RegistrationWindow {
  if (event.status !== "published" || event.publishedAt === null) {
    return { state: "unavailable" };
  }
  const opensAt = event.registrationOpensAt ?? event.publishedAt;
  const closesAt = event.registrationClosesAt ?? event.startsAt;
  const t = now.getTime();
  const state =
    t < opensAt.getTime()
      ? "not_open_yet"
      : t < closesAt.getTime()
        ? "open"
        : "closed";
  return { state, opensAt, closesAt };
}
