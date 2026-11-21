import { describe, expect, it } from "vitest";

import {
  KEY_DATE_KINDS,
  dueTransitions,
  isStale,
  planStatusJob,
  rescheduledJobs,
  statusJobs,
  upcomingChange,
  type KeyDates,
} from "./status-schedule";

// Registration opens 10:00 IST on 1 Feb and closes 23:59 IST on 28 Feb.
const OPEN = new Date("2027-02-01T04:30:00.000Z");
const CLOSE = new Date("2027-02-28T18:29:00.000Z");
const SUBMIT = new Date("2027-03-15T18:29:00.000Z");
const DATES: KeyDates = {
  registration_open: OPEN,
  registration_close: CLOSE,
  submission_deadline: SUBMIT,
};

const before = (at: Date, ms = 1) => new Date(at.getTime() - ms);
const after = (at: Date, ms = 1) => new Date(at.getTime() + ms);

describe("KEY_DATE_KINDS", () => {
  it("lists the key dates in timeline order", () => {
    expect(KEY_DATE_KINDS).toEqual([
      "registration_open",
      "registration_close",
      "submission_deadline",
      "school_judging_deadline",
      "results",
    ]);
  });
});

describe("statusJobs", () => {
  it("schedules one job for every key date that is set", () => {
    expect(statusJobs("published", DATES)).toEqual([
      { kind: "registration_open", dueAt: OPEN },
      { kind: "registration_close", dueAt: CLOSE },
      { kind: "submission_deadline", dueAt: SUBMIT },
    ]);
  });

  it("schedules nothing for a draft", () => {
    expect(statusJobs("draft", DATES)).toEqual([]);
  });
});

describe("rescheduledJobs", () => {
  it("schedules only the dates that changed or were added", () => {
    const moved = after(OPEN, 86_400_000);
    const results = new Date("2027-04-01T04:30:00.000Z");
    expect(
      rescheduledJobs("published", DATES, {
        ...DATES,
        registration_open: moved,
        results,
      })
    ).toEqual([
      { kind: "registration_open", dueAt: moved },
      { kind: "results", dueAt: results },
    ]);
  });

  it("schedules nothing when no date changed", () => {
    expect(
      rescheduledJobs("published", DATES, {
        ...DATES,
        registration_open: new Date(OPEN.getTime()),
      })
    ).toEqual([]);
  });

  it("schedules nothing for a draft; publishing schedules everything", () => {
    expect(
      rescheduledJobs("draft", DATES, {
        ...DATES,
        registration_open: after(OPEN),
      })
    ).toEqual([]);
  });

  it("schedules nothing for a removed date; its old job goes stale", () => {
    const { submission_deadline: _removed, ...rest } = DATES;
    expect(rescheduledJobs("published", DATES, rest)).toEqual([]);
    expect(isStale({ kind: "submission_deadline", dueAt: SUBMIT }, rest)).toBe(
      true
    );
  });
});

describe("isStale", () => {
  it("is false while the date is still the one the job was made for", () => {
    expect(
      isStale(
        { kind: "registration_open", dueAt: new Date(OPEN.getTime()) },
        DATES
      )
    ).toBe(false);
  });

  it("is true once the date has moved", () => {
    expect(
      isStale(
        { kind: "registration_open", dueAt: OPEN },
        { ...DATES, registration_open: after(OPEN, 60_000) }
      )
    ).toBe(true);
  });
});

describe("dueTransitions", () => {
  it("moves nothing before registration opens", () => {
    expect(dueTransitions("published", DATES, before(OPEN))).toEqual([]);
  });

  it("opens registration at the opening instant itself", () => {
    expect(dueTransitions("published", DATES, OPEN)).toEqual([
      {
        from: "published",
        to: "registration_open",
        keyDate: "registration_open",
        at: OPEN,
      },
    ]);
  });

  it("closes registration once the closing instant passes", () => {
    expect(dueTransitions("registration_open", DATES, after(CLOSE))).toEqual([
      {
        from: "registration_open",
        to: "registration_closed",
        keyDate: "registration_close",
        at: CLOSE,
      },
    ]);
  });

  it("catches up every passed step, in order, one transition each", () => {
    expect(
      dueTransitions("published", DATES, after(CLOSE)).map((t) => t.to)
    ).toEqual(["registration_open", "registration_closed"]);
  });

  it("stops at a step whose date is not set", () => {
    const { registration_close: _unset, ...openOnly } = DATES;
    expect(
      dueTransitions("published", openOnly, after(CLOSE)).map((t) => t.to)
    ).toEqual(["registration_open"]);
  });

  it("moves nothing for a draft, whatever the dates", () => {
    expect(dueTransitions("draft", DATES, after(CLOSE))).toEqual([]);
  });

  it("moves nothing past the last status this machine knows", () => {
    expect(dueTransitions("registration_closed", DATES, after(SUBMIT))).toEqual(
      []
    );
  });
});

describe("planStatusJob", () => {
  const openJob = { kind: "registration_open" as const, dueAt: OPEN };

  it("advances when the job's instant has come", () => {
    expect(
      planStatusJob(openJob, { status: "published", keyDates: DATES }, OPEN)
    ).toEqual({
      kind: "advance",
      transitions: [
        {
          from: "published",
          to: "registration_open",
          keyDate: "registration_open",
          at: OPEN,
        },
      ],
    });
  });

  it("does nothing for a job whose date was moved", () => {
    const moved = { ...DATES, registration_open: after(OPEN, 3_600_000) };
    expect(
      planStatusJob(
        openJob,
        { status: "published", keyDates: moved },
        after(OPEN)
      )
    ).toEqual({ kind: "stale" });
  });

  it("asks to run again at its instant when it ran early", () => {
    expect(
      planStatusJob(
        openJob,
        { status: "published", keyDates: DATES },
        before(OPEN)
      )
    ).toEqual({ kind: "early", dueAt: OPEN });
  });

  it("advances nothing when the move already happened", () => {
    expect(
      planStatusJob(
        openJob,
        { status: "registration_open", keyDates: DATES },
        after(OPEN)
      )
    ).toEqual({ kind: "advance", transitions: [] });
  });

  it("lets a later date's job catch up the earlier step too", () => {
    const closeJob = { kind: "registration_close" as const, dueAt: CLOSE };
    const plan = planStatusJob(
      closeJob,
      { status: "published", keyDates: DATES },
      after(CLOSE)
    );
    expect(
      plan.kind === "advance" ? plan.transitions.map((t) => t.to) : plan
    ).toEqual(["registration_open", "registration_closed"]);
  });

  it("advances nothing for a date no status change hangs on yet", () => {
    expect(
      planStatusJob(
        { kind: "submission_deadline", dueAt: SUBMIT },
        { status: "registration_closed", keyDates: DATES },
        after(SUBMIT)
      )
    ).toEqual({ kind: "advance", transitions: [] });
  });
});

describe("upcomingChange", () => {
  it("counts down to registration opening", () => {
    expect(upcomingChange("published", DATES, before(OPEN))).toEqual({
      kind: "scheduled",
      to: "registration_open",
      at: OPEN,
    });
  });

  it("counts down to registration closing while it is open", () => {
    expect(upcomingChange("registration_open", DATES, after(OPEN))).toEqual({
      kind: "scheduled",
      to: "registration_closed",
      at: CLOSE,
    });
  });

  it("says the move is due, never a negative countdown, once it is late", () => {
    expect(upcomingChange("published", DATES, after(OPEN))).toEqual({
      kind: "due",
      to: "registration_open",
      at: OPEN,
    });
  });

  it("has nothing ahead after registration closes", () => {
    expect(
      upcomingChange("registration_closed", DATES, after(CLOSE))
    ).toBeNull();
  });

  it("has nothing ahead for a draft or a missing date", () => {
    expect(upcomingChange("draft", DATES, before(OPEN))).toBeNull();
    expect(upcomingChange("published", {}, before(OPEN))).toBeNull();
  });
});
