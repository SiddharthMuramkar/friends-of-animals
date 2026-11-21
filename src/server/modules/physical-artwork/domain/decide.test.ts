import { describe, expect, it } from "vitest";

import {
  COURIER_NAME_MAX,
  decideArtwork,
  decideArtworkRequest,
  parseDispatchDetails,
  type ArtworkCommand,
  type ArtworkState,
} from "./decide";
import {
  PHYSICAL_ARTWORK_STATUSES,
  artworkTransition,
  type PhysicalArtworkStatus,
} from "./status";

const HOUR = 60 * 60 * 1000;

const NOW = new Date("2027-01-15T04:30:00.000Z");
/** End of 29 January IST: 14 days after NOW. */
const DEADLINE = new Date("2027-01-29T18:29:59.000Z");

const SETTINGS = { dispatchDays: 14, reminderLeadHours: 72 };

const VALID = { courierName: "Blue Dart", trackingNumber: "12345678901" };

function state(status: PhysicalArtworkStatus): ArtworkState {
  return { status, dispatchDeadline: DEADLINE };
}

const AFTER_RECEIPT = PHYSICAL_ARTWORK_STATUSES.filter(
  (status) => !["requested", "dispatched"].includes(status)
);

describe("decideArtworkRequest", () => {
  const facts = {
    entryStatus: "foa_verified",
    physicalArtworkRequired: true,
    alreadyRequested: false,
  };

  it("requests a verified entry's artwork, with its deadline and reminder", () => {
    expect(decideArtworkRequest(facts, SETTINGS, NOW)).toEqual({
      ok: true,
      to: "requested",
      event: "artwork.requested",
      dispatchDeadline: DEADLINE,
      reminderAt: new Date(DEADLINE.getTime() - 72 * HOUR),
    });
  });

  it("schedules no reminder when the window is shorter than the lead time", () => {
    const decision = decideArtworkRequest(
      facts,
      { dispatchDays: 3, reminderLeadHours: 336 },
      NOW
    );
    expect(decision).toMatchObject({ ok: true, reminderAt: null });
  });

  it.each([
    "processing",
    "submitted",
    "submitted_to_foa",
    "sent_back",
    "rejected",
    "failed",
  ])("refuses an entry that is %s", (entryStatus) => {
    expect(
      decideArtworkRequest({ ...facts, entryStatus }, SETTINGS, NOW)
    ).toEqual({ ok: false, code: "entry_not_verified" });
  });

  it("refuses an entry whose artwork was already requested", () => {
    expect(
      decideArtworkRequest({ ...facts, alreadyRequested: true }, SETTINGS, NOW)
    ).toEqual({ ok: false, code: "already_requested" });
  });

  it("refuses when the competition doesn't need the original work, first", () => {
    expect(
      decideArtworkRequest(
        {
          entryStatus: "submitted",
          physicalArtworkRequired: false,
          alreadyRequested: true,
        },
        SETTINGS,
        NOW
      )
    ).toEqual({ ok: false, code: "physical_not_required" });
  });

  it("throws on settings outside their bounds", () => {
    expect(() =>
      decideArtworkRequest(
        facts,
        { dispatchDays: 0, reminderLeadHours: 72 },
        NOW
      )
    ).toThrow(RangeError);
    expect(() =>
      decideArtworkRequest(
        facts,
        { dispatchDays: 14, reminderLeadHours: 0 },
        NOW
      )
    ).toThrow(RangeError);
  });
});

describe("parseDispatchDetails", () => {
  it("trims the courier and collapses its spaces", () => {
    expect(
      parseDispatchDetails({
        courierName: "  India   Post ",
        trackingNumber: "EE123456789IN",
      })
    ).toEqual({ courierName: "India Post", trackingNumber: "EE123456789IN" });
  });

  it("removes spaces from the tracking number and upper-cases it", () => {
    expect(
      parseDispatchDetails({
        courierName: "DTDC",
        trackingNumber: " d1234 5678 9-x ",
      })
    ).toEqual({ courierName: "DTDC", trackingNumber: "D123456789-X" });
  });

  it("accepts a courier name of the longest length", () => {
    const courierName = "C".repeat(COURIER_NAME_MAX);
    expect(parseDispatchDetails({ ...VALID, courierName })).toMatchObject({
      courierName,
    });
  });

  it.each([
    [{ trackingNumber: "1234" }, "courier_name_required"],
    [{ courierName: "   ", trackingNumber: "1234" }, "courier_name_required"],
    [{ courierName: 7, trackingNumber: "1234" }, "courier_name_required"],
    [
      { courierName: "C".repeat(COURIER_NAME_MAX + 1), trackingNumber: "1234" },
      "courier_name_too_long",
    ],
    [{ courierName: "DTDC" }, "tracking_number_required"],
    [{ courierName: "DTDC", trackingNumber: "  " }, "tracking_number_required"],
    [{ courierName: "DTDC", trackingNumber: 1234 }, "tracking_number_required"],
    [{ courierName: "DTDC", trackingNumber: "123" }, "tracking_number_invalid"],
    [
      { courierName: "DTDC", trackingNumber: "1".repeat(41) },
      "tracking_number_invalid",
    ],
    [
      { courierName: "DTDC", trackingNumber: "-1234" },
      "tracking_number_invalid",
    ],
    [
      { courierName: "DTDC", trackingNumber: "1234-" },
      "tracking_number_invalid",
    ],
    [
      { courierName: "DTDC", trackingNumber: "12#34" },
      "tracking_number_invalid",
    ],
    [
      { courierName: "DTDC", trackingNumber: "12/34" },
      "tracking_number_invalid",
    ],
  ])("refuses %j with %s", (input, code) => {
    expect(parseDispatchDetails(input)).toBe(code);
  });

  it("checks the courier before the tracking number", () => {
    expect(parseDispatchDetails({})).toBe("courier_name_required");
  });
});

describe("decideArtwork: dispatch", () => {
  const dispatch: ArtworkCommand = { kind: "dispatch", details: VALID };

  it("dispatches a requested artwork with the parsed courier and tracking", () => {
    expect(decideArtwork(state("requested"), dispatch, NOW)).toEqual({
      ok: true,
      to: "dispatched",
      event: "artwork.dispatched",
      courierName: "Blue Dart",
      trackingNumber: "12345678901",
      late: false,
    });
  });

  it("is on time at the deadline and late one second after it", () => {
    expect(decideArtwork(state("requested"), dispatch, DEADLINE)).toMatchObject(
      { ok: true, late: false }
    );
    expect(
      decideArtwork(
        state("requested"),
        dispatch,
        new Date(DEADLINE.getTime() + 1000)
      )
    ).toMatchObject({ ok: true, late: true });
  });

  it("refuses a second dispatch", () => {
    expect(decideArtwork(state("dispatched"), dispatch, NOW)).toEqual({
      ok: false,
      code: "already_dispatched",
    });
  });

  it.each(AFTER_RECEIPT)("refuses an artwork that is %s", (status) => {
    expect(decideArtwork(state(status), dispatch, NOW)).toEqual({
      ok: false,
      code: "already_received",
    });
  });

  it("refuses bad details", () => {
    expect(
      decideArtwork(
        state("requested"),
        { kind: "dispatch", details: { courierName: "Blue Dart" } },
        NOW
      )
    ).toEqual({ ok: false, code: "tracking_number_required" });
  });

  it("reports the status before the details", () => {
    expect(
      decideArtwork(state("dispatched"), { kind: "dispatch", details: {} }, NOW)
    ).toEqual({ ok: false, code: "already_dispatched" });
  });
});

describe("decideArtwork: receive", () => {
  const receive: ArtworkCommand = { kind: "receive" };

  it("receives a dispatched artwork", () => {
    expect(decideArtwork(state("dispatched"), receive, NOW)).toEqual({
      ok: true,
      to: "received",
      event: "artwork.received",
      dispatchRecorded: true,
    });
  });

  it("receives an artwork whose dispatch was never recorded, and says so", () => {
    expect(decideArtwork(state("requested"), receive, NOW)).toEqual({
      ok: true,
      to: "received",
      event: "artwork.received",
      dispatchRecorded: false,
    });
  });

  it("ignores the deadline: late work is still received", () => {
    expect(
      decideArtwork(
        state("requested"),
        receive,
        new Date(DEADLINE.getTime() + 30 * 24 * HOUR)
      )
    ).toMatchObject({ ok: true, to: "received" });
  });

  it.each(AFTER_RECEIPT)("refuses an artwork that is %s", (status) => {
    expect(decideArtwork(state(status), receive, NOW)).toEqual({
      ok: false,
      code: "already_received",
    });
  });
});

describe("decideArtwork: remind", () => {
  const remind: ArtworkCommand = { kind: "remind" };

  it("reminds while the artwork is requested and the deadline is ahead", () => {
    expect(
      decideArtwork(
        state("requested"),
        remind,
        new Date(DEADLINE.getTime() - 72 * HOUR)
      )
    ).toEqual({ ok: true, to: null, event: "artwork.dispatch_reminder" });
  });

  it("stays quiet once the deadline has passed", () => {
    expect(decideArtwork(state("requested"), remind, DEADLINE)).toEqual({
      ok: false,
      code: "deadline_passed",
    });
  });

  it("stays quiet once the sender has dispatched", () => {
    expect(decideArtwork(state("dispatched"), remind, NOW)).toEqual({
      ok: false,
      code: "already_dispatched",
    });
  });

  it.each(AFTER_RECEIPT)("stays quiet for an artwork that is %s", (status) => {
    expect(decideArtwork(state(status), remind, NOW)).toEqual({
      ok: false,
      code: "already_received",
    });
  });
});

describe("decideArtwork and the transition table agree", () => {
  const commands: ArtworkCommand[] = [
    { kind: "dispatch", details: VALID },
    { kind: "receive" },
    { kind: "remind" },
  ];

  it.each(PHYSICAL_ARTWORK_STATUSES)(
    "every move accepted from %s is in the table",
    (status) => {
      for (const command of commands) {
        const decision = decideArtwork(state(status), command, NOW);
        if (decision.ok && decision.to !== null) {
          expect(artworkTransition(status, decision.to)).not.toBeNull();
        }
      }
    }
  );
});
