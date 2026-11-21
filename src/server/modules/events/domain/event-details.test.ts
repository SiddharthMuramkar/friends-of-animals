import { describe, expect, it } from "vitest";

import {
  EVENT_AUDIENCES,
  eventDetailsSchema,
  publishableProblems,
  type EventDetailsInput,
} from "./event-details";

// A Saturday beach clean-up, 07:00-10:00 IST on 13 February 2027.
const startsAt = new Date("2027-02-13T01:30:00.000Z");
const endsAt = new Date("2027-02-13T04:30:00.000Z");

const valid: EventDetailsInput = {
  kind: "event",
  title: "Beach clean-up at Juhu",
  summary: "Join volunteers to clear plastic from the shore before the tide.",
  description: [{ p: ["Bring a water bottle and a hat."] }],
  startsAt,
  endsAt,
  venueName: "Juhu Beach, Gate 4",
  address: "",
  city: "Mumbai",
  pinCode: "400049",
  onlineUrl: "",
  capacity: 40,
  audience: "members",
  registrationOpensAt: null,
  registrationClosesAt: null,
  waitlistEnabled: true,
};

const problemsOf = (input: EventDetailsInput) => {
  const result = eventDetailsSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
};

describe("eventDetailsSchema", () => {
  it("accepts a complete in-person event and turns blank optional text into null", () => {
    const details = eventDetailsSchema.parse(valid);

    expect(details).toMatchObject({
      title: "Beach clean-up at Juhu",
      venueName: "Juhu Beach, Gate 4",
      address: null,
      city: "Mumbai",
      pinCode: "400049",
      onlineUrl: null,
      capacity: 40,
      waitlistEnabled: true,
    });
  });

  it("trims text fields", () => {
    const details = eventDetailsSchema.parse({
      ...valid,
      title: "  Beach clean-up at Juhu  ",
      city: " Mumbai ",
    });

    expect(details.title).toBe("Beach clean-up at Juhu");
    expect(details.city).toBe("Mumbai");
  });

  it("offers members-only and any signed-in person as audiences", () => {
    expect(EVENT_AUDIENCES).toEqual(["members", "signed_in"]);
  });

  it("refuses an event that ends at or before it starts", () => {
    expect(problemsOf({ ...valid, endsAt: startsAt })).toEqual([
      { path: "endsAt", message: "ends_before_start" },
    ]);
  });

  it("needs a place for an event: a venue with its city, or an online link", () => {
    const placeless = { ...valid, venueName: "", city: "", pinCode: "" };

    expect(problemsOf(placeless)).toEqual([
      { path: "venueName", message: "place_required" },
    ]);
    expect(
      problemsOf({ ...placeless, onlineUrl: "https://meet.example.test/foa" })
    ).toEqual([]);
  });

  it("needs the city with a venue", () => {
    expect(problemsOf({ ...valid, city: "" })).toEqual([
      { path: "city", message: "city_required" },
    ]);
  });

  it("lets a campaign run without a place", () => {
    expect(
      problemsOf({
        ...valid,
        kind: "campaign",
        venueName: "",
        city: "",
        pinCode: "",
      })
    ).toEqual([]);
  });

  it("accepts only a six-digit PIN code that doesn't start with 0", () => {
    expect(problemsOf({ ...valid, pinCode: "40004" })).toHaveLength(1);
    expect(problemsOf({ ...valid, pinCode: "040049" })).toHaveLength(1);
    expect(problemsOf({ ...valid, pinCode: "4000 49" })).toHaveLength(1);
    expect(problemsOf({ ...valid, pinCode: "" })).toEqual([]);
  });

  it("accepts only https online links", () => {
    expect(
      problemsOf({ ...valid, onlineUrl: "http://meet.example.test/foa" })
    ).toHaveLength(1);
    expect(
      problemsOf({ ...valid, onlineUrl: "javascript:alert(1)" })
    ).toHaveLength(1);
    expect(
      problemsOf({ ...valid, onlineUrl: "https://meet.example.test/foa" })
    ).toEqual([]);
  });

  it("takes a whole positive capacity, or none for unlimited", () => {
    expect(problemsOf({ ...valid, capacity: 0 })).toHaveLength(1);
    expect(problemsOf({ ...valid, capacity: 2.5 })).toHaveLength(1);
    expect(problemsOf({ ...valid, capacity: null })).toEqual([]);
  });

  it("drops the waitlist when places are unlimited, since nobody would wait", () => {
    const details = eventDetailsSchema.parse({
      ...valid,
      capacity: null,
      waitlistEnabled: true,
    });

    expect(details.waitlistEnabled).toBe(false);
  });

  it("refuses a registration window that closes before it opens", () => {
    expect(
      problemsOf({
        ...valid,
        registrationOpensAt: new Date("2027-02-10T00:00:00.000Z"),
        registrationClosesAt: new Date("2027-02-09T00:00:00.000Z"),
      })
    ).toEqual([
      { path: "registrationOpensAt", message: "registration_window_empty" },
    ]);
  });

  it("refuses registration that would only open once the event has started", () => {
    expect(problemsOf({ ...valid, registrationOpensAt: startsAt })).toEqual([
      { path: "registrationOpensAt", message: "registration_window_empty" },
    ]);
  });

  it("lets registration stay open into the event but not past its end", () => {
    expect(
      problemsOf({
        ...valid,
        registrationClosesAt: new Date("2027-02-13T03:00:00.000Z"),
      })
    ).toEqual([]);
    expect(
      problemsOf({
        ...valid,
        registrationClosesAt: new Date("2027-02-13T05:00:00.000Z"),
      })
    ).toEqual([
      {
        path: "registrationClosesAt",
        message: "registration_closes_after_end",
      },
    ]);
  });

  it("refuses a title too short to find or too long to show", () => {
    expect(problemsOf({ ...valid, title: "Go" })).toHaveLength(1);
    expect(problemsOf({ ...valid, title: "x".repeat(121) })).toHaveLength(1);
  });
});

describe("publishableProblems", () => {
  const details = eventDetailsSchema.parse(valid);

  it("allows publishing an event that hasn't started", () => {
    expect(
      publishableProblems(details, new Date("2027-01-15T04:30:00.000Z"))
    ).toEqual([]);
  });

  it("refuses publishing, or moving a published event, to a start already past", () => {
    expect(publishableProblems(details, startsAt)).toEqual(["starts_in_past"]);
    expect(
      publishableProblems(details, new Date("2027-02-14T00:00:00.000Z"))
    ).toEqual(["starts_in_past"]);
  });
});
