// What happens to an outbox delivery after the relay ran its handler: done,
// tried again later with a growing delay, or kept as failed for staff to see.
// Pure, so the worker, the preview drain route and the Seam 1 drain settle
// deliveries the same way, with times from the injected clock only.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

/** Where a delivery stands. Only a pending delivery is ever claimed. */
export type DeliveryStatus = "pending" | "dispatched" | "failed";

export type RetryPolicy = {
  /** Attempts in all, the first one included. */
  maxAttempts: number;
  /** The wait after the first failed attempt; it doubles each time. */
  firstDelayMs: number;
  /** No wait is ever longer than this. */
  maxDelayMs: number;
  /**
   * How long a claim holds a delivery. A worker that dies mid-handler leaves
   * it claimed; once the lease runs out, the delivery is due again.
   */
  leaseMs: number;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Waits 30 s, 1, 2 and 4 minutes; fails after the fifth attempt. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  firstDelayMs: 30 * SECOND,
  maxDelayMs: 30 * MINUTE,
  leaseMs: 5 * MINUTE,
};

/** A delivery as the relay claimed it: `attempts` counts this attempt. */
export type ClaimedDelivery = { status: DeliveryStatus; attempts: number };

/** How the handler went. `error` is already described (./failure.ts). */
export type DeliveryOutcome = { ok: true } | { ok: false; error: string };

/** The columns to write when settling. Every settlement releases the claim. */
export type Settlement =
  | {
      status: "dispatched";
      dispatchedAt: Date;
      lockedUntil: null;
      lastError: null;
    }
  | {
      status: "pending";
      availableAt: Date;
      lockedUntil: null;
      lastError: string;
    }
  | { status: "failed"; failedAt: Date; lockedUntil: null; lastError: string };

/** Thrown when settling a delivery that isn't claimed and pending. */
export class DeliveryTransitionError extends Error {
  constructor(delivery: ClaimedDelivery) {
    super(
      `Only a claimed pending delivery can be settled; this one is ` +
        `${delivery.status} after ${delivery.attempts} attempt(s).`
    );
    this.name = "DeliveryTransitionError";
  }
}

/**
 * Settles a claimed delivery at `now`: dispatched on success; on failure,
 * pending again after a delay that doubles with each attempt (capped), or
 * failed once `maxAttempts` attempts have failed. Throws
 * DeliveryTransitionError for a delivery that is dispatched, failed or was
 * never claimed.
 */
export function settleDelivery(
  delivery: ClaimedDelivery,
  outcome: DeliveryOutcome,
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Settlement {
  if (delivery.status !== "pending" || delivery.attempts < 1) {
    throw new DeliveryTransitionError(delivery);
  }
  if (outcome.ok) {
    return {
      status: "dispatched",
      dispatchedAt: now,
      lockedUntil: null,
      lastError: null,
    };
  }
  if (delivery.attempts >= policy.maxAttempts) {
    return {
      status: "failed",
      failedAt: now,
      lockedUntil: null,
      lastError: outcome.error,
    };
  }
  const delay = Math.min(
    policy.firstDelayMs * 2 ** (delivery.attempts - 1),
    policy.maxDelayMs
  );
  return {
    status: "pending",
    availableAt: new Date(now.getTime() + delay),
    lockedUntil: null,
    lastError: outcome.error,
  };
}

/** When a delivery claimed at `now` becomes due again if never settled. */
export function claimUntil(
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Date {
  return new Date(now.getTime() + policy.leaseMs);
}
