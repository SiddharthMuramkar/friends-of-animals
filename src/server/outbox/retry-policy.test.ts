import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETRY_POLICY,
  DeliveryTransitionError,
  claimUntil,
  settleDelivery,
  type DeliveryStatus,
  type RetryPolicy,
} from "./retry-policy";

const NOW = new Date("2027-01-15T04:30:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const failure = { ok: false, error: "Error: SMTP refused" } as const;

describe("settleDelivery", () => {
  it("marks a delivery dispatched when its handler succeeds", () => {
    expect(
      settleDelivery({ status: "pending", attempts: 1 }, { ok: true }, NOW)
    ).toEqual({
      status: "dispatched",
      dispatchedAt: NOW,
      lockedUntil: null,
      lastError: null,
    });
  });

  it("retries a failed attempt after 30 s, then 1, 2 and 4 minutes", () => {
    const retryAt = (attempts: number) =>
      settleDelivery({ status: "pending", attempts }, failure, NOW);

    expect(retryAt(1)).toEqual({
      status: "pending",
      availableAt: at(30 * SECOND),
      lockedUntil: null,
      lastError: "Error: SMTP refused",
    });
    expect(retryAt(2)).toMatchObject({ availableAt: at(1 * MINUTE) });
    expect(retryAt(3)).toMatchObject({ availableAt: at(2 * MINUTE) });
    expect(retryAt(4)).toMatchObject({ availableAt: at(4 * MINUTE) });
  });

  it("gives up after the fifth failed attempt and keeps the error", () => {
    expect(
      settleDelivery({ status: "pending", attempts: 5 }, failure, NOW)
    ).toEqual({
      status: "failed",
      failedAt: NOW,
      lockedUntil: null,
      lastError: "Error: SMTP refused",
    });
  });

  it("never waits longer than the policy's longest delay", () => {
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 20,
      maxDelayMs: 10 * MINUTE,
    };

    expect(
      settleDelivery({ status: "pending", attempts: 6 }, failure, NOW, policy)
    ).toMatchObject({ status: "pending", availableAt: at(10 * MINUTE) });
    expect(
      settleDelivery({ status: "pending", attempts: 19 }, failure, NOW, policy)
    ).toMatchObject({ status: "pending", availableAt: at(10 * MINUTE) });
    expect(
      settleDelivery({ status: "pending", attempts: 20 }, failure, NOW, policy)
    ).toMatchObject({ status: "failed" });
  });

  it("fails on the first error when the policy allows one attempt", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };

    expect(
      settleDelivery({ status: "pending", attempts: 1 }, failure, NOW, policy)
    ).toMatchObject({ status: "failed" });
  });

  describe("transitions", () => {
    const outcomes = [
      ["success", { ok: true }],
      ["failure", failure],
    ] as const;
    const finished: DeliveryStatus[] = ["dispatched", "failed"];

    it.each(outcomes)(
      "settles a claimed pending delivery on %s",
      (_, outcome) => {
        expect(() =>
          settleDelivery({ status: "pending", attempts: 1 }, outcome, NOW)
        ).not.toThrow();
      }
    );

    for (const status of finished) {
      it.each(outcomes)(
        `refuses to settle a ${status} delivery on %s`,
        (_, outcome) => {
          expect(() =>
            settleDelivery({ status, attempts: 1 }, outcome, NOW)
          ).toThrow(DeliveryTransitionError);
        }
      );
    }

    it.each(outcomes)(
      "refuses to settle a delivery that was never claimed, on %s",
      (_, outcome) => {
        expect(() =>
          settleDelivery({ status: "pending", attempts: 0 }, outcome, NOW)
        ).toThrow(DeliveryTransitionError);
      }
    );
  });
});

describe("claimUntil", () => {
  it("holds a claimed delivery for five minutes", () => {
    expect(claimUntil(NOW)).toEqual(at(5 * MINUTE));
  });

  it("follows the policy's lease", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, leaseMs: 90 * SECOND };
    expect(claimUntil(NOW, policy)).toEqual(at(90 * SECOND));
  });
});
