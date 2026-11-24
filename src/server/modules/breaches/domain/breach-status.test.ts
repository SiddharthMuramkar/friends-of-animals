import { describe, expect, it } from "vitest";

import {
  BREACH_EVENTS,
  BREACH_STATUSES,
  BREACH_TRANSITIONS,
  allowedBreachEvents,
  breachRecordSchema,
  decideBreachTransition,
  type BreachEvent,
  type BreachState,
  type BreachStatus,
} from "./breach-status";

const CONTAINED_AT = new Date("2027-01-15T06:00:00.000Z");

/** Every allowed move, written out once by hand: from, event, to. */
const ALLOWED: [BreachStatus, BreachEvent, BreachStatus][] = [
  ["open", "contain", "contained"],
  ["open", "notify", "notified"],
  ["contained", "notify", "notified"],
  ["contained", "close", "closed"],
  ["notified", "contain", "notified"],
  ["notified", "notify", "notified"],
  ["notified", "close", "closed"],
];

/** The state a breach at `status` is normally in. */
function at(
  status: BreachStatus,
  containedAt: Date | null = null
): BreachState {
  return { status, containedAt, authorityEmailQueuedAt: null };
}

describe("the breach transition table", () => {
  it("keeps the exported table and the hand-written list in step", () => {
    const fromTable = BREACH_STATUSES.flatMap((from) =>
      Object.entries(BREACH_TRANSITIONS[from]).map(([event, to]) => [
        from,
        event,
        to,
      ])
    );
    expect(fromTable).toEqual(ALLOWED);
  });

  it("refuses every pair the table doesn't list", () => {
    for (const from of BREACH_STATUSES) {
      for (const event of BREACH_EVENTS) {
        if (ALLOWED.some(([f, e]) => f === from && e === event)) continue;
        expect(
          decideBreachTransition(at(from, CONTAINED_AT), event, {
            noNoticeReason: "No personal data left the bucket",
          }).ok,
          `${from} --${event}-->`
        ).toBe(false);
      }
    }
  });

  it("contains an open breach and stamps the time", () => {
    expect(decideBreachTransition(at("open"), "contain")).toEqual({
      ok: true,
      to: "contained",
      stampContainedAt: true,
    });
  });

  it("lets a notice go out before containment", () => {
    expect(decideBreachTransition(at("open"), "notify")).toEqual({
      ok: true,
      to: "notified",
      stampContainedAt: false,
    });
  });

  it("contains a notified breach without moving it", () => {
    expect(decideBreachTransition(at("notified"), "contain")).toEqual({
      ok: true,
      to: "notified",
      stampContainedAt: true,
    });
  });

  it("says a contained breach is already contained", () => {
    expect(
      decideBreachTransition(at("contained", CONTAINED_AT), "contain")
    ).toEqual({ ok: false, reason: "already_contained" });
  });

  it("refuses containing a breach twice", () => {
    expect(
      decideBreachTransition(at("notified", CONTAINED_AT), "contain")
    ).toEqual({ ok: false, reason: "already_contained" });
  });

  it("keeps a breach notified when a second notice goes out", () => {
    expect(
      decideBreachTransition(at("notified", CONTAINED_AT), "notify")
    ).toEqual({ ok: true, to: "notified", stampContainedAt: false });
  });

  it("refuses closing an open breach", () => {
    expect(
      decideBreachTransition(at("open"), "close", { noNoticeReason: "x" })
    ).toEqual({ ok: false, reason: "transition_not_allowed" });
  });

  it("closes a contained breach without notice only with a reason", () => {
    const contained = at("contained", CONTAINED_AT);
    expect(decideBreachTransition(contained, "close")).toEqual({
      ok: false,
      reason: "reason_required",
    });
    expect(
      decideBreachTransition(contained, "close", { noNoticeReason: "   " })
    ).toEqual({ ok: false, reason: "reason_required" });
    expect(
      decideBreachTransition(contained, "close", {
        noNoticeReason: "The leaked file held no personal data",
      })
    ).toEqual({ ok: true, to: "closed", stampContainedAt: false });
  });

  it("closes a notified breach only once it is contained", () => {
    expect(decideBreachTransition(at("notified"), "close")).toEqual({
      ok: false,
      reason: "not_contained",
    });
    expect(
      decideBreachTransition(at("notified", CONTAINED_AT), "close")
    ).toEqual({ ok: true, to: "closed", stampContainedAt: false });
  });

  it("never moves a closed breach, and says why", () => {
    for (const event of BREACH_EVENTS) {
      expect(
        decideBreachTransition(at("closed", CONTAINED_AT), event, {
          noNoticeReason: "x",
        })
      ).toEqual({ ok: false, reason: "breach_closed" });
    }
  });

  it("never takes a notified breach back to open", () => {
    for (const event of BREACH_EVENTS) {
      const decision = decideBreachTransition(at("notified"), event);
      if (decision.ok) expect(decision.to).not.toBe("open");
    }
  });
});

describe("allowedBreachEvents", () => {
  it("lists what staff can do next", () => {
    expect(allowedBreachEvents(at("open"))).toEqual(["contain", "notify"]);
    expect(allowedBreachEvents(at("contained", CONTAINED_AT))).toEqual([
      "notify",
      "close",
    ]);
    expect(allowedBreachEvents(at("notified"))).toEqual(["contain", "notify"]);
    expect(allowedBreachEvents(at("notified", CONTAINED_AT))).toEqual([
      "notify",
      "close",
    ]);
    expect(allowedBreachEvents(at("closed", CONTAINED_AT))).toEqual([]);
  });
});

describe("breachRecordSchema", () => {
  const valid = {
    title: "  Export file sent to the wrong school  ",
    awareAt: "2027-01-15T04:00:00.000Z",
    severity: "high",
    personalDataInvolved: true,
    minorsAffected: true,
    affectedCount: 3,
    impact: "Names and classes of 3 pupils were visible to another school.",
  };

  it("takes a breach and trims its text", () => {
    expect(breachRecordSchema.parse(valid)).toEqual({
      ...valid,
      title: "Export file sent to the wrong school",
      awareAt: new Date("2027-01-15T04:00:00.000Z"),
    });
  });

  it("refuses a blank title or impact, a bad severity or a negative count", () => {
    for (const bad of [
      { title: " " },
      { impact: "" },
      { severity: "catastrophic" },
      { affectedCount: -1 },
      { affectedCount: 2.5 },
      { affectedCount: 2_147_483_648 },
      { awareAt: "yesterday" },
      { extra: "field" },
    ]) {
      expect(
        breachRecordSchema.safeParse({ ...valid, ...bad }).success,
        JSON.stringify(bad)
      ).toBe(false);
    }
  });
});
