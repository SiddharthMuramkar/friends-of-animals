import { describe, expect, it } from "vitest";

import {
  orderWaitlist,
  placeForNewRegistration,
  planPromotions,
  waitlistPosition,
  type WaitlistEntry,
} from "./waitlist";

const at = (minute: number) =>
  new Date(Date.UTC(2027, 0, 20, 10, minute, 0, 0));

const entry = (id: string, minute: number): WaitlistEntry => ({
  id,
  waitlistedAt: at(minute),
});

describe("placeForNewRegistration", () => {
  it("gives a place while places are left", () => {
    expect(
      placeForNewRegistration({
        capacity: 2,
        placesTaken: 1,
        waitlistEnabled: true,
      })
    ).toEqual({ status: "registered" });
  });

  it("puts the next person on the waitlist once the event is full", () => {
    expect(
      placeForNewRegistration({
        capacity: 2,
        placesTaken: 2,
        waitlistEnabled: true,
      })
    ).toEqual({ status: "waitlisted" });
  });

  it("refuses once full when the event has no waitlist", () => {
    expect(
      placeForNewRegistration({
        capacity: 2,
        placesTaken: 2,
        waitlistEnabled: false,
      })
    ).toEqual({ refused: "full" });
  });

  it("waitlists, never overbooks, when capacity was lowered below the places taken", () => {
    expect(
      placeForNewRegistration({
        capacity: 2,
        placesTaken: 3,
        waitlistEnabled: true,
      })
    ).toEqual({ status: "waitlisted" });
  });

  it("always gives a place when places are unlimited", () => {
    expect(
      placeForNewRegistration({
        capacity: null,
        placesTaken: 10_000,
        waitlistEnabled: false,
      })
    ).toEqual({ status: "registered" });
  });

  it("joins the back of a waitlist people are already on, even if a place looks free", () => {
    // A place freed and its promotion not yet run must go to the person
    // waiting longest, not to whoever registers next.
    expect(
      placeForNewRegistration({
        capacity: 2,
        placesTaken: 1,
        waitlistEnabled: true,
        waiting: 1,
      })
    ).toEqual({ status: "waitlisted" });
  });
});

describe("orderWaitlist", () => {
  it("orders by when people joined, then by id for the same instant", () => {
    const ordered = orderWaitlist([
      entry("c", 5),
      entry("b", 1),
      entry("a", 1),
      entry("d", 3),
    ]);

    expect(ordered.map((e) => e.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("leaves the input untouched", () => {
    const input = [entry("b", 2), entry("a", 1)];
    orderWaitlist(input);
    expect(input.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("planPromotions", () => {
  const waitlist = [entry("w3", 3), entry("w1", 1), entry("w2", 2)];

  it("promotes the person waiting longest into one freed place", () => {
    expect(planPromotions({ capacity: 2, placesTaken: 1, waitlist })).toEqual([
      "w1",
    ]);
  });

  it("fills every free place in waitlist order, as after raising capacity", () => {
    expect(planPromotions({ capacity: 4, placesTaken: 2, waitlist })).toEqual([
      "w1",
      "w2",
    ]);
  });

  it("promotes nobody while the event is full or over capacity", () => {
    expect(planPromotions({ capacity: 2, placesTaken: 2, waitlist })).toEqual(
      []
    );
    expect(planPromotions({ capacity: 2, placesTaken: 3, waitlist })).toEqual(
      []
    );
  });

  it("promotes everyone waiting when places become unlimited", () => {
    expect(
      planPromotions({ capacity: null, placesTaken: 50, waitlist })
    ).toEqual(["w1", "w2", "w3"]);
  });

  it("promotes nobody when nobody is waiting", () => {
    expect(
      planPromotions({ capacity: 5, placesTaken: 0, waitlist: [] })
    ).toEqual([]);
  });

  it("promotes two people in waitlist order after two cancellations", () => {
    // Capacity 2, both places freed one after the other: each run promotes
    // the next in line.
    const first = planPromotions({ capacity: 2, placesTaken: 1, waitlist });
    const rest = waitlist.filter((e) => !first.includes(e.id));
    const second = planPromotions({
      capacity: 2,
      placesTaken: 1,
      waitlist: rest,
    });

    expect([...first, ...second]).toEqual(["w1", "w2"]);
  });
});

describe("waitlistPosition", () => {
  const waitlist = [entry("w3", 3), entry("w1", 1), entry("w2", 2)];

  it("gives a 1-based place in line", () => {
    expect(waitlistPosition(waitlist, "w1")).toBe(1);
    expect(waitlistPosition(waitlist, "w3")).toBe(3);
  });

  it("is null for someone not waiting", () => {
    expect(waitlistPosition(waitlist, "r1")).toBeNull();
  });
});
