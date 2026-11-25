import { describe, expect, it } from "vitest";

import {
  registrationWindow,
  type RegistrationWindowEvent,
} from "./registration-window";

const publishedAt = new Date("2027-01-15T04:30:00.000Z");
const startsAt = new Date("2027-02-13T01:30:00.000Z");

const event: RegistrationWindowEvent = {
  status: "published",
  publishedAt,
  startsAt,
  registrationOpensAt: null,
  registrationClosesAt: null,
};

const at = (iso: string) => new Date(iso);

describe("registrationWindow", () => {
  it("is open from publishing until the start when no window is set", () => {
    expect(registrationWindow(event, publishedAt)).toEqual({
      state: "open",
      opensAt: publishedAt,
      closesAt: startsAt,
    });
    expect(
      registrationWindow(event, new Date(startsAt.getTime() - 1)).state
    ).toBe("open");
  });

  it("closes the moment the event starts", () => {
    expect(registrationWindow(event, startsAt)).toEqual({
      state: "closed",
      opensAt: publishedAt,
      closesAt: startsAt,
    });
  });

  it("is not open yet before its own opening time", () => {
    const opensAt = at("2027-02-01T04:30:00.000Z");
    const withWindow = { ...event, registrationOpensAt: opensAt };

    expect(
      registrationWindow(withWindow, at("2027-01-31T00:00:00.000Z"))
    ).toEqual({ state: "not_open_yet", opensAt, closesAt: startsAt });
    expect(registrationWindow(withWindow, opensAt).state).toBe("open");
  });

  it("can close before the start, or stay open into the event", () => {
    const early = at("2027-02-12T12:30:00.000Z");
    const late = at("2027-02-13T03:00:00.000Z");

    expect(
      registrationWindow({ ...event, registrationClosesAt: early }, early).state
    ).toBe("closed");
    expect(
      registrationWindow(
        { ...event, registrationClosesAt: late },
        at("2027-02-13T02:00:00.000Z")
      ).state
    ).toBe("open");
  });

  it.each(["draft", "cancelled", "completed"] as const)(
    "is unavailable while the event is %s",
    (status) => {
      expect(
        registrationWindow(
          {
            ...event,
            status,
            publishedAt: status === "draft" ? null : publishedAt,
          },
          at("2027-02-01T00:00:00.000Z")
        )
      ).toEqual({ state: "unavailable" });
    }
  );
});
