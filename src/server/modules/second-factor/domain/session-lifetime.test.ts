import { describe, expect, it } from "vitest";

import {
  capSessionExpiry,
  isSessionLive,
  SESSION_LIFETIME_DEFAULTS,
  sessionLifetimeMs,
} from "./session-lifetime";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const createdAt = new Date("2027-01-15T04:30:00.000Z");
const after = (ms: number) => new Date(createdAt.getTime() + ms);

describe("sessionLifetimeMs", () => {
  it("defaults to 30 days for members and 12 hours for staff", () => {
    expect(SESSION_LIFETIME_DEFAULTS).toEqual({
      memberMs: 30 * DAY,
      staffMs: 12 * HOUR,
    });
    expect(sessionLifetimeMs(["member"])).toBe(30 * DAY);
    expect(sessionLifetimeMs(["member", "content_manager"])).toBe(12 * HOUR);
  });

  it("follows the lifetimes the settings give", () => {
    const lifetimes = { memberMs: 7 * DAY, staffMs: 8 * HOUR };
    expect(sessionLifetimeMs(["judge"], lifetimes)).toBe(7 * DAY);
    expect(sessionLifetimeMs(["finance"], lifetimes)).toBe(8 * HOUR);
  });
});

describe("capSessionExpiry", () => {
  it("cuts a new staff session to 12 hours", () => {
    expect(
      capSessionExpiry({
        createdAt,
        expiresAt: after(30 * DAY),
        roles: ["super_admin"],
      })
    ).toEqual(after(12 * HOUR));
  });

  it("leaves a member session alone", () => {
    expect(
      capSessionExpiry({
        createdAt,
        expiresAt: after(30 * DAY),
        roles: ["member"],
      })
    ).toEqual(after(30 * DAY));
    expect(
      capSessionExpiry({
        createdAt,
        expiresAt: after(2 * DAY),
        roles: ["member"],
      })
    ).toEqual(after(2 * DAY));
  });

  it("stops a refresh from stretching a staff session past 12 hours from sign-in", () => {
    // Six hours in, a refresh proposes another 30 days from then.
    expect(
      capSessionExpiry({
        createdAt,
        expiresAt: after(6 * HOUR + 30 * DAY),
        roles: ["finance"],
      })
    ).toEqual(after(12 * HOUR));
  });

  it("shortens a member's live session when they are granted a staff role", () => {
    // Signed in 2 hours ago as a member; now granted finance.
    expect(
      capSessionExpiry({
        createdAt,
        expiresAt: after(30 * DAY),
        roles: ["member", "finance"],
      })
    ).toEqual(after(12 * HOUR));
  });
});

describe("isSessionLive", () => {
  it("ends a staff session after 12 hours, whatever expiry is stored", () => {
    const session = {
      createdAt,
      expiresAt: after(30 * DAY),
      roles: ["staff_admin"],
    };
    expect(isSessionLive({ ...session, now: after(12 * HOUR - 1000) })).toBe(
      true
    );
    expect(isSessionLive({ ...session, now: after(12 * HOUR) })).toBe(false);
  });

  it("keeps a member session for 30 days", () => {
    const session = {
      createdAt,
      expiresAt: after(30 * DAY),
      roles: ["member"],
    };
    expect(isSessionLive({ ...session, now: after(29 * DAY) })).toBe(true);
    expect(isSessionLive({ ...session, now: after(30 * DAY + 1000) })).toBe(
      false
    );
  });

  it("ends a session signed in long ago as soon as a staff role is granted", () => {
    expect(
      isSessionLive({
        createdAt,
        expiresAt: after(30 * DAY),
        roles: ["member", "finance"],
        now: after(20 * HOUR),
      })
    ).toBe(false);
  });

  it("honours a stored expiry that comes sooner, such as a revoked session", () => {
    expect(
      isSessionLive({
        createdAt,
        expiresAt: after(HOUR),
        roles: ["finance"],
        now: after(2 * HOUR),
      })
    ).toBe(false);
  });
});
