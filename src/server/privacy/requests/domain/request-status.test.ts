import { describe, expect, it } from "vitest";

import {
  decideRequestTransition,
  INITIAL_REQUEST_STATUS,
  isOpenRequest,
  PRIVACY_REQUEST_STATUSES,
  REQUEST_EVENTS,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
  type RequestEvent,
} from "./request-status";

// The transition table from the M5 conventions, written out cell by cell:
// [from, event, type or "any", expected status or refusal].
type Cell = [
  PrivacyRequestStatus,
  RequestEvent,
  PrivacyRequestType | "any",
  `to:${PrivacyRequestStatus}` | `no:${string}`,
];

const TABLE: Cell[] = [
  // submitted
  ["submitted", "start", "any", "to:in_progress"],
  ["submitted", "assign", "any", "to:in_progress"],
  ["submitted", "cancel", "any", "to:cancelled"],
  ["submitted", "reject", "any", "to:rejected"],
  ["submitted", "complete", "any", "no:not_started"],
  ["submitted", "complete_with_retained", "erasure", "no:not_started"],
  ["submitted", "complete_with_retained", "access", "no:not_erasure"],
  // in_progress
  ["in_progress", "start", "any", "no:already_started"],
  ["in_progress", "assign", "any", "to:in_progress"],
  ["in_progress", "cancel", "any", "no:already_in_progress"],
  ["in_progress", "reject", "any", "to:rejected"],
  ["in_progress", "complete", "any", "to:completed"],
  [
    "in_progress",
    "complete_with_retained",
    "erasure",
    "to:partially_completed",
  ],
  ["in_progress", "complete_with_retained", "access", "no:not_erasure"],
  ["in_progress", "complete_with_retained", "correction", "no:not_erasure"],
];

const TYPES: PrivacyRequestType[] = ["access", "correction", "erasure"];

function expand(cells: Cell[]) {
  return cells.flatMap(([from, event, type, expected]) =>
    (type === "any" ? TYPES : [type]).map(
      (t) => [from, event, t, expected] as const
    )
  );
}

function outcome(
  from: PrivacyRequestStatus,
  event: RequestEvent,
  type: PrivacyRequestType
) {
  const decision = decideRequestTransition({ from, event, type });
  return decision.ok ? `to:${decision.to}` : `no:${decision.reason}`;
}

describe("decideRequestTransition", () => {
  it.each(expand(TABLE))(
    "%s --%s (%s)--> %s",
    (from, event, type, expected) => {
      expect(outcome(from, event, type)).toBe(expected);
    }
  );

  it("refuses every event once a request is closed", () => {
    const closed = PRIVACY_REQUEST_STATUSES.filter((s) => !isOpenRequest(s));
    expect(closed).toEqual([
      "completed",
      "partially_completed",
      "rejected",
      "cancelled",
    ]);
    for (const from of closed) {
      for (const event of REQUEST_EVENTS) {
        for (const type of TYPES) {
          expect(outcome(from, event, type)).toBe("no:request_closed");
        }
      }
    }
  });

  it("covers every open status and event in the table", () => {
    const covered = new Set(TABLE.map(([from, event]) => `${from}/${event}`));
    for (const from of PRIVACY_REQUEST_STATUSES.filter(isOpenRequest)) {
      for (const event of REQUEST_EVENTS) {
        expect(covered).toContain(`${from}/${event}`);
      }
    }
  });

  it("starts every request as submitted", () => {
    expect(INITIAL_REQUEST_STATUS).toBe("submitted");
  });
});
