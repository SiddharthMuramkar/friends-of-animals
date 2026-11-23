import { describe, expect, it } from "vitest";

import {
  LOCKOUT_DEFAULTS,
  lockedUntil,
  NO_FAILURES,
  recordFailure,
  type LockoutState,
} from "./lockout";

const MINUTE = 60 * 1000;
const start = new Date("2027-01-15T04:30:00.000Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);

/** Fails once at each of `minutes`, from a clean slate. */
function failAt(minutes: number[], from: LockoutState = NO_FAILURES) {
  let state = from;
  let lockedNow = false;
  for (const minute of minutes) {
    ({ state, lockedNow } = recordFailure(state, at(minute)));
  }
  return { state, lockedNow };
}

describe("second-factor lockout", () => {
  it("defaults to 5 failures in 15 minutes locking for 15 minutes", () => {
    expect(LOCKOUT_DEFAULTS).toEqual({
      maxFailures: 5,
      windowMs: 15 * MINUTE,
      lockMs: 15 * MINUTE,
    });
  });

  it("doesn't lock after 4 failures", () => {
    const { state, lockedNow } = failAt([0, 1, 2, 3]);
    expect(lockedNow).toBe(false);
    expect(lockedUntil(state, at(3))).toBeNull();
  });

  it("locks for 15 minutes on the 5th failure inside the window", () => {
    const { state, lockedNow } = failAt([0, 1, 2, 3, 14]);
    expect(lockedNow).toBe(true);
    expect(lockedUntil(state, at(14))).toEqual(at(29));
    expect(lockedUntil(state, at(28))).toEqual(at(29));
  });

  it("unlocks when the lock runs out, with a fresh count", () => {
    const locked = failAt([0, 1, 2, 3, 4]).state;
    expect(lockedUntil(locked, at(19))).toBeNull();
    const { state, lockedNow } = failAt([19], locked);
    expect(lockedNow).toBe(false);
    expect(lockedUntil(state, at(19))).toBeNull();
  });

  it("starts counting again once the window has passed", () => {
    const { state, lockedNow } = failAt([0, 1, 2, 3, 16]);
    expect(lockedNow).toBe(false);
    expect(lockedUntil(state, at(16))).toBeNull();
    expect(failAt([17, 18, 19], state).lockedNow).toBe(false);
    expect(failAt([17, 18, 19, 20], state).lockedNow).toBe(true);
  });

  it("doesn't extend a lock when a failure is recorded during it", () => {
    const locked = failAt([0, 1, 2, 3, 4]).state;
    const { state, lockedNow } = recordFailure(locked, at(10));
    expect(lockedNow).toBe(false);
    expect(lockedUntil(state, at(10))).toEqual(at(19));
  });

  it("follows the policy it is given", () => {
    const policy = { maxFailures: 3, windowMs: 5 * MINUTE, lockMs: MINUTE };
    let state = NO_FAILURES;
    let lockedNow = false;
    for (const minute of [0, 1, 2]) {
      ({ state, lockedNow } = recordFailure(state, at(minute), policy));
    }
    expect(lockedNow).toBe(true);
    expect(lockedUntil(state, at(2))).toEqual(at(3));
  });
});
