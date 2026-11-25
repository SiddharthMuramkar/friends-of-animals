// Physical artwork rules (#93): what requesting an entry's artwork, the
// sender recording its dispatch, FOA marking it received and the dispatch
// reminder do. Pure: the use cases check who is acting, lock and load the
// rows, call these functions, then write the status, the audit row and the
// outbox event they name. Nothing here reads the database, the clock or
// the settings; `now` and the setting values come in.
//
// The track starts only once FOA has verified the entry, so no work is
// couriered just to be eliminated. Late dispatch is allowed and flagged.
// FOA can receive a parcel whose dispatch was never recorded.
//
// Loads under plain Node: no "server-only", no `@/` imports.

import { dispatchDeadline, dispatchReminderAt } from "./schedule";
import {
  artworkTransition,
  type ArtworkMover,
  type PhysicalArtworkStatus,
} from "./status";

/** The longest courier name, in characters. */
export const COURIER_NAME_MAX = 60;

/**
 * Tracking numbers are entered by hand, so they are normalised (spaces
 * removed, upper case) and checked only for shape: 4 to 40 letters, digits
 * and inner hyphens.
 */
const TRACKING_NUMBER = /^[A-Z0-9][A-Z0-9-]{2,38}[A-Z0-9]$/;

/** The entry status the physical track starts from. */
const VERIFIED_ENTRY = "foa_verified";

export type DispatchDetails = { courierName: string; trackingNumber: string };

export type DispatchRefusal =
  | "courier_name_required"
  | "courier_name_too_long"
  | "tracking_number_required"
  | "tracking_number_invalid";

/** What the request use case knows about one entry. */
export type ArtworkRequestFacts = {
  /** The entry's current status: any `entry_status` value. */
  entryStatus: string;
  /** The competition's physical-artwork rule asks for original work. */
  physicalArtworkRequired: boolean;
  /** The entry already has a physical artwork record. */
  alreadyRequested: boolean;
};

/** The setting values in force when the request is made. */
export type ArtworkRequestSettings = {
  /** `artwork.dispatchDays`. */
  dispatchDays: number;
  /** `artwork.dispatchReminderLeadHours`. */
  reminderLeadHours: number;
};

export type ArtworkRequestRefusal =
  | "physical_not_required"
  | "already_requested"
  | "entry_not_verified";

export type ArtworkRequestDecision =
  | {
      ok: true;
      to: "requested";
      event: "artwork.requested";
      dispatchDeadline: Date;
      /** Null when the window is too short for a reminder. */
      reminderAt: Date | null;
    }
  | { ok: false; code: ArtworkRequestRefusal };

/** What `decideArtwork` needs to know about the artwork. */
export type ArtworkState = {
  status: PhysicalArtworkStatus;
  dispatchDeadline: Date;
};

export type ArtworkCommand =
  /** The sender records the courier and tracking number. */
  | {
      kind: "dispatch";
      /** Unparsed, as the form sent it. */
      details: { courierName?: unknown; trackingNumber?: unknown };
    }
  /** FOA staff mark the parcel received. */
  | { kind: "receive" }
  /** The dispatch reminder job fires. */
  | { kind: "remind" };

export type ArtworkRefusal =
  | "already_dispatched"
  | "already_received"
  | "deadline_passed"
  | DispatchRefusal;

export type ArtworkDecision =
  | ({
      ok: true;
      to: "dispatched";
      event: "artwork.dispatched";
      /** Dispatched after the deadline. */
      late: boolean;
    } & DispatchDetails)
  | {
      ok: true;
      to: "received";
      event: "artwork.received";
      /** False when the sender never recorded the dispatch. */
      dispatchRecorded: boolean;
    }
  /** Send the reminder; the status stays `requested`. */
  | { ok: true; to: null; event: "artwork.dispatch_reminder" }
  | { ok: false; code: ArtworkRefusal };

/**
 * Whether FOA can ask for this entry's original work at `now`, and if so
 * the dispatch deadline and when to remind. Throws only on setting values
 * the registry never produces.
 */
export function decideArtworkRequest(
  facts: ArtworkRequestFacts,
  settings: ArtworkRequestSettings,
  now: Date
): ArtworkRequestDecision {
  const deadline = dispatchDeadline(now, settings.dispatchDays);
  const reminderAt = dispatchReminderAt({
    requestedAt: now,
    deadline,
    leadHours: settings.reminderLeadHours,
  });
  if (!facts.physicalArtworkRequired) {
    return { ok: false, code: "physical_not_required" };
  }
  if (facts.alreadyRequested) return { ok: false, code: "already_requested" };
  if (facts.entryStatus !== VERIFIED_ENTRY) {
    return { ok: false, code: "entry_not_verified" };
  }
  return {
    ok: true,
    to: "requested",
    event: "artwork.requested",
    dispatchDeadline: deadline,
    reminderAt,
  };
}

/**
 * The courier name (trimmed, inner spaces collapsed) and tracking number
 * (spaces removed, upper case), or why they are refused. The dispatch form
 * runs the same check.
 */
export function parseDispatchDetails(input: {
  courierName?: unknown;
  trackingNumber?: unknown;
}): DispatchDetails | DispatchRefusal {
  const courierName =
    typeof input.courierName === "string"
      ? input.courierName.trim().replace(/\s+/g, " ")
      : "";
  if (courierName === "") return "courier_name_required";
  if (courierName.length > COURIER_NAME_MAX) return "courier_name_too_long";
  const trackingNumber =
    typeof input.trackingNumber === "string"
      ? input.trackingNumber.replace(/\s+/g, "").toUpperCase()
      : "";
  if (trackingNumber === "") return "tracking_number_required";
  if (!TRACKING_NUMBER.test(trackingNumber)) return "tracking_number_invalid";
  return { courierName, trackingNumber };
}

/** Checks a move against the table, which must allow it for `mover`. */
function assertMove(
  from: PhysicalArtworkStatus,
  to: PhysicalArtworkStatus,
  mover: ArtworkMover
): void {
  if (artworkTransition(from, to)?.by !== mover) {
    throw new Error(`The transition table has no ${from} → ${to} by ${mover}`);
  }
}

/**
 * What `command` does to an artwork in `state` at `now`: the status it
 * moves to and the event to emit, or why it is refused.
 */
export function decideArtwork(
  state: ArtworkState,
  command: ArtworkCommand,
  now: Date
): ArtworkDecision {
  switch (command.kind) {
    case "dispatch": {
      if (state.status === "dispatched") {
        return { ok: false, code: "already_dispatched" };
      }
      if (state.status !== "requested") {
        return { ok: false, code: "already_received" };
      }
      assertMove(state.status, "dispatched", "sender");
      const details = parseDispatchDetails(command.details);
      if (typeof details === "string") return { ok: false, code: details };
      return {
        ok: true,
        to: "dispatched",
        event: "artwork.dispatched",
        ...details,
        late: now.getTime() > state.dispatchDeadline.getTime(),
      };
    }

    case "receive": {
      if (state.status !== "requested" && state.status !== "dispatched") {
        return { ok: false, code: "already_received" };
      }
      assertMove(state.status, "received", "staff");
      return {
        ok: true,
        to: "received",
        event: "artwork.received",
        dispatchRecorded: state.status === "dispatched",
      };
    }

    case "remind": {
      if (state.status === "dispatched") {
        return { ok: false, code: "already_dispatched" };
      }
      if (state.status !== "requested") {
        return { ok: false, code: "already_received" };
      }
      if (now.getTime() >= state.dispatchDeadline.getTime()) {
        return { ok: false, code: "deadline_passed" };
      }
      return { ok: true, to: null, event: "artwork.dispatch_reminder" };
    }
  }
}
