import { describe, expect, it } from "vitest";

import { registrationWindow } from "./registration-window";

const CLOSES = new Date("2027-02-01T18:29:59.999Z");
const BEFORE_CLOSE = new Date("2027-01-20T04:30:00.000Z");
const AT_CLOSE = CLOSES;
const AFTER_CLOSE = new Date("2027-02-02T04:30:00.000Z");

describe("registrationWindow", () => {
  it("is unpublished while the competition is a draft", () => {
    expect(
      registrationWindow(
        { status: "draft", registrationClosesAt: CLOSES },
        BEFORE_CLOSE
      )
    ).toBe("unpublished");
  });

  it("is not open yet while the competition is only published", () => {
    expect(
      registrationWindow(
        { status: "published", registrationClosesAt: CLOSES },
        BEFORE_CLOSE
      )
    ).toBe("not_open_yet");
  });

  it("is open while the status says so and the close has not come", () => {
    expect(
      registrationWindow(
        { status: "registration_open", registrationClosesAt: CLOSES },
        BEFORE_CLOSE
      )
    ).toBe("open");
  });

  it("is open with no closing date set", () => {
    expect(
      registrationWindow(
        { status: "registration_open", registrationClosesAt: null },
        AFTER_CLOSE
      )
    ).toBe("open");
  });

  it.each([
    ["at the closing instant", AT_CLOSE],
    ["after the closing instant", AFTER_CLOSE],
  ])(
    "is closed %s even if a late worker has not moved the status",
    (_when, now) => {
      expect(
        registrationWindow(
          { status: "registration_open", registrationClosesAt: CLOSES },
          now
        )
      ).toBe("closed");
    }
  );

  it.each([
    "registration_closed",
    "school_judging",
    "foa_judging",
    "cancelled",
    "something_new",
  ])("is closed for the status %s", (status) => {
    expect(
      registrationWindow({ status, registrationClosesAt: CLOSES }, BEFORE_CLOSE)
    ).toBe("closed");
  });
});
