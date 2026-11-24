import { describe, expect, it } from "vitest";

import {
  isOpenVolunteerApplication,
  OPEN_VOLUNTEER_APPLICATION_STATUSES,
  transitionVolunteerApplication,
  VOLUNTEER_APPLICATION_EVENTS,
  VOLUNTEER_APPLICATION_STATUSES,
  type VolunteerApplicationEvent,
  type VolunteerApplicationStatus,
} from "./application-status";

// The whole table, written out by hand: every status against every event.
// A cell is the status the application moves to, or null when the move is
// refused. Changing the machine means changing this table on purpose.
const EXPECTED: Record<
  VolunteerApplicationStatus,
  Record<VolunteerApplicationEvent, VolunteerApplicationStatus | null>
> = {
  awaiting_guardian: {
    guardian_approve: "submitted",
    guardian_decline: "guardian_declined",
    withdraw: "withdrawn",
    approve: null,
    decline: null,
  },
  submitted: {
    guardian_approve: null,
    guardian_decline: null,
    withdraw: "withdrawn",
    approve: "approved",
    decline: "declined",
  },
  guardian_declined: {
    guardian_approve: null,
    guardian_decline: null,
    withdraw: null,
    approve: null,
    decline: null,
  },
  approved: {
    guardian_approve: null,
    guardian_decline: null,
    withdraw: null,
    approve: null,
    decline: null,
  },
  declined: {
    guardian_approve: null,
    guardian_decline: null,
    withdraw: null,
    approve: null,
    decline: null,
  },
  withdrawn: {
    guardian_approve: null,
    guardian_decline: null,
    withdraw: null,
    approve: null,
    decline: null,
  },
};

describe("transitionVolunteerApplication", () => {
  it("covers every status and every event", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      [...VOLUNTEER_APPLICATION_STATUSES].sort()
    );
    for (const row of Object.values(EXPECTED)) {
      expect(Object.keys(row).sort()).toEqual(
        [...VOLUNTEER_APPLICATION_EVENTS].sort()
      );
    }
  });

  for (const from of VOLUNTEER_APPLICATION_STATUSES) {
    for (const event of VOLUNTEER_APPLICATION_EVENTS) {
      const to = EXPECTED[from][event];
      const title = to
        ? `moves ${from} to ${to} on ${event}`
        : `refuses ${event} from ${from}`;
      it(title, () => {
        expect(transitionVolunteerApplication(from, event)).toEqual(
          to ? { ok: true, to } : { ok: false, reason: "invalid_transition" }
        );
      });
    }
  }

  it("never moves anything back to waiting for the guardian", () => {
    for (const from of VOLUNTEER_APPLICATION_STATUSES) {
      for (const event of VOLUNTEER_APPLICATION_EVENTS) {
        const result = transitionVolunteerApplication(from, event);
        if (result.ok) expect(result.to).not.toBe("awaiting_guardian");
      }
    }
  });

  it("reaches approved only from submitted, so a minor's guardian always decides first", () => {
    const sources = VOLUNTEER_APPLICATION_STATUSES.filter((from) =>
      VOLUNTEER_APPLICATION_EVENTS.some((event) => {
        const result = transitionVolunteerApplication(from, event);
        return result.ok && result.to === "approved";
      })
    );
    expect(sources).toEqual(["submitted"]);
  });
});

describe("open applications", () => {
  it("counts only the two statuses still waiting on someone", () => {
    expect([...OPEN_VOLUNTEER_APPLICATION_STATUSES].sort()).toEqual([
      "awaiting_guardian",
      "submitted",
    ]);
    expect(
      VOLUNTEER_APPLICATION_STATUSES.filter(isOpenVolunteerApplication).sort()
    ).toEqual(["awaiting_guardian", "submitted"]);
  });

  it("lets every open application be withdrawn and no closed one", () => {
    for (const status of VOLUNTEER_APPLICATION_STATUSES) {
      expect(transitionVolunteerApplication(status, "withdraw").ok).toBe(
        isOpenVolunteerApplication(status)
      );
    }
  });
});
