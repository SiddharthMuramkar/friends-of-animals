import { describe, expect, it } from "vitest";

import {
  type LocalRecurring,
  type RecurringSyncContext,
  type RemoteCharge,
  type RemoteSubscription,
  planRecurringSync,
} from "./recurring-sync";

const HOUR = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

// Started at 10:00 IST on 15 January 2027.
const STARTED = at("2027-01-15T04:30:00.000Z");
const CYCLE_1 = at("2027-01-15T04:31:00.000Z");
const CYCLE_2 = at("2027-02-15T04:31:00.000Z");
const CYCLE_3 = at("2027-03-15T04:31:00.000Z");

function local(overrides: Partial<LocalRecurring> = {}): LocalRecurring {
  return {
    status: "active",
    createdAt: STARTED,
    cancelRequestedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function remote(
  status: string,
  overrides: Partial<RemoteSubscription> = {}
): RemoteSubscription {
  return {
    status,
    currentStart: CYCLE_1,
    chargeAt: CYCLE_2,
    endedAt: null,
    ...overrides,
  };
}

function charge(
  paymentId: string,
  createdAt: Date,
  overrides: Partial<RemoteCharge> = {}
): RemoteCharge {
  return {
    paymentId,
    captured: true,
    amountMinor: 100_000n,
    currency: "INR",
    international: false,
    createdAt,
    ...overrides,
  };
}

function context(
  overrides: Partial<RecurringSyncContext> = {}
): RecurringSyncContext {
  return {
    now: at("2027-01-15T05:00:00.000Z"),
    handledPaymentIds: new Set(),
    noticedFailureCycles: new Set(),
    authorisationWindowMs: 24 * HOUR,
    ...overrides,
  };
}

const ids = (charges: readonly RemoteCharge[]) =>
  charges.map((c) => c.paymentId);

describe("authorisation and charges", () => {
  it("activates once the mandate is authorised, recording nothing", () => {
    const plan = planRecurringSync(
      local({ status: "pending_authorisation" }),
      remote("authenticated"),
      [],
      context()
    );
    expect(plan.move).toEqual({
      event: "authorised",
      from: "pending_authorisation",
      to: "active",
    });
    expect(plan.record).toEqual([]);
    expect(plan.nextChargeAt).toEqual(CYCLE_2);
    expect(plan.conflict).toBeNull();
  });

  it("records the first charge even when it is seen before the authorisation", () => {
    const p1 = charge("pay_1", CYCLE_1);
    const plan = planRecurringSync(
      local({ status: "pending_authorisation" }),
      remote("active"),
      [p1],
      context()
    );
    expect(plan.move).toEqual({
      event: "charged",
      from: "pending_authorisation",
      to: "active",
    });
    expect(ids(plan.record)).toEqual(["pay_1"]);
  });

  it("changes nothing when the same charge is seen again", () => {
    const plan = planRecurringSync(
      local(),
      remote("active"),
      [charge("pay_1", CYCLE_1)],
      context({ handledPaymentIds: new Set(["pay_1"]) })
    );
    expect(plan.move).toBeNull();
    expect(plan.record).toEqual([]);
    expect(plan.refundAfterCancel).toEqual([]);
    expect(plan.failureNotice).toBeNull();
  });

  it("records next month's charge as a new donation without a status move", () => {
    const plan = planRecurringSync(
      local(),
      remote("active", { currentStart: CYCLE_2, chargeAt: CYCLE_3 }),
      [charge("pay_1", CYCLE_1), charge("pay_2", CYCLE_2)],
      context({ handledPaymentIds: new Set(["pay_1"]) })
    );
    expect(plan.move).toBeNull();
    expect(ids(plan.record)).toEqual(["pay_2"]);
    expect(plan.nextChargeAt).toEqual(CYCLE_3);
  });

  it("records several new charges oldest first, so receipt numbers follow them", () => {
    const plan = planRecurringSync(
      local(),
      remote("active"),
      [
        charge("pay_c", CYCLE_3),
        charge("pay_a", CYCLE_1),
        charge("pay_b2", CYCLE_2),
        charge("pay_b1", CYCLE_2),
      ],
      context()
    );
    expect(ids(plan.record)).toEqual(["pay_a", "pay_b1", "pay_b2", "pay_c"]);
  });

  it("never records a failed payment attempt", () => {
    const plan = planRecurringSync(
      local(),
      remote("active"),
      [charge("pay_failed", CYCLE_2, { captured: false })],
      context()
    );
    expect(plan.record).toEqual([]);
    expect(plan.refundAfterCancel).toEqual([]);
  });

  it("leaves a mandate waiting for authorisation alone", () => {
    const plan = planRecurringSync(
      local({ status: "pending_authorisation" }),
      remote("created", { currentStart: null, chargeAt: null }),
      [],
      context()
    );
    expect(plan).toMatchObject({
      move: null,
      status: "pending_authorisation",
      cancelAtGateway: null,
      conflict: null,
      nextChargeAt: null,
    });
  });
});

describe("failed charges", () => {
  it("moves to past_due and tells the donor once for the cycle", () => {
    const plan = planRecurringSync(
      local(),
      remote("pending", { currentStart: CYCLE_2 }),
      [
        charge("pay_1", CYCLE_1),
        charge("pay_f1", CYCLE_2, { captured: false }),
      ],
      context({ handledPaymentIds: new Set(["pay_1"]) })
    );
    expect(plan.move).toEqual({
      event: "charge_failed",
      from: "active",
      to: "past_due",
    });
    expect(plan.failureNotice).toEqual({ cycleKey: CYCLE_2.toISOString() });
    expect(plan.record).toEqual([]);
  });

  it("stays quiet when the cycle's failure was already announced", () => {
    const plan = planRecurringSync(
      local({ status: "past_due" }),
      remote("pending", { currentStart: CYCLE_2 }),
      [],
      context({ noticedFailureCycles: new Set([CYCLE_2.toISOString()]) })
    );
    expect(plan.move).toBeNull();
    expect(plan.failureNotice).toBeNull();
  });

  it("announces a failure again in a later cycle", () => {
    const plan = planRecurringSync(
      local(),
      remote("pending", { currentStart: CYCLE_3 }),
      [],
      context({ noticedFailureCycles: new Set([CYCLE_2.toISOString()]) })
    );
    expect(plan.failureNotice).toEqual({ cycleKey: CYCLE_3.toISOString() });
  });

  it("falls back to the charge date, then a fixed key, to name the cycle", () => {
    const byChargeAt = planRecurringSync(
      local(),
      remote("pending", { currentStart: null, chargeAt: CYCLE_2 }),
      [],
      context()
    );
    expect(byChargeAt.failureNotice).toEqual({
      cycleKey: CYCLE_2.toISOString(),
    });
    const neither = planRecurringSync(
      local(),
      remote("pending", { currentStart: null, chargeAt: null }),
      [],
      context()
    );
    expect(neither.failureNotice).toEqual({ cycleKey: "first-cycle" });
  });

  it("returns to active when a retry is captured", () => {
    const plan = planRecurringSync(
      local({ status: "past_due" }),
      remote("active", { currentStart: CYCLE_2 }),
      [charge("pay_retry", CYCLE_2)],
      context()
    );
    expect(plan.move).toEqual({
      event: "charged",
      from: "past_due",
      to: "active",
    });
    expect(ids(plan.record)).toEqual(["pay_retry"]);
  });

  it("halts when retries run out, announcing the cycle if nobody was told", () => {
    const plan = planRecurringSync(
      local({ status: "past_due" }),
      remote("halted", { currentStart: CYCLE_2, chargeAt: null }),
      [],
      context()
    );
    expect(plan.move).toEqual({
      event: "retries_exhausted",
      from: "past_due",
      to: "halted",
    });
    expect(plan.failureNotice).toEqual({ cycleKey: CYCLE_2.toISOString() });
    expect(plan.nextChargeAt).toBeNull();
  });

  it("halts straight from active when the retrying signal was missed", () => {
    const plan = planRecurringSync(
      local(),
      remote("halted", { currentStart: CYCLE_2 }),
      [],
      context()
    );
    expect(plan.move?.to).toBe("halted");
  });

  it("follows the gateway back to active from halted", () => {
    const plan = planRecurringSync(
      local({ status: "halted" }),
      remote("active", { currentStart: CYCLE_3 }),
      [],
      context()
    );
    expect(plan.move).toEqual({
      event: "authorised",
      from: "halted",
      to: "active",
    });
  });
});

describe("cancellation", () => {
  const REQUESTED = at("2027-02-20T06:00:00.000Z");

  it("asks the gateway to cancel while it still reports the subscription live", () => {
    const plan = planRecurringSync(
      local({ cancelRequestedAt: REQUESTED }),
      remote("active"),
      [],
      context()
    );
    expect(plan.cancelAtGateway).toBe("requested");
    expect(plan.move).toBeNull();
    expect(plan.nextChargeAt).toBeNull();
  });

  it("doesn't announce a failed charge once the donor asked to cancel", () => {
    const plan = planRecurringSync(
      local({ cancelRequestedAt: REQUESTED }),
      remote("pending", { currentStart: CYCLE_2 }),
      [],
      context()
    );
    expect(plan.failureNotice).toBeNull();
    expect(plan.cancelAtGateway).toBe("requested");
  });

  it("cancels once the gateway confirms, and stops asking", () => {
    const plan = planRecurringSync(
      local({ cancelRequestedAt: REQUESTED }),
      remote("cancelled", { endedAt: REQUESTED, chargeAt: null }),
      [],
      context()
    );
    expect(plan.move).toEqual({
      event: "cancelled",
      from: "active",
      to: "cancelled",
    });
    expect(plan.cancelAtGateway).toBeNull();
    expect(plan.nextChargeAt).toBeNull();
  });

  it("refunds a charge made after the request and keeps the ones before", () => {
    const before = charge("pay_2", CYCLE_2);
    const after = charge("pay_3", at("2027-02-20T06:00:00.000Z"));
    const plan = planRecurringSync(
      local({ cancelRequestedAt: REQUESTED }),
      remote("active"),
      [before, after],
      context()
    );
    expect(ids(plan.record)).toEqual(["pay_2"]);
    expect(ids(plan.refundAfterCancel)).toEqual(["pay_3"]);
  });

  it("refunds a late charge on a cancelled donation without reviving it", () => {
    const plan = planRecurringSync(
      local({
        status: "cancelled",
        cancelRequestedAt: REQUESTED,
        cancelledAt: REQUESTED,
      }),
      remote("cancelled", { endedAt: REQUESTED }),
      [charge("pay_late", CYCLE_3)],
      context()
    );
    expect(plan.move).toBeNull();
    expect(plan.status).toBe("cancelled");
    expect(plan.record).toEqual([]);
    expect(ids(plan.refundAfterCancel)).toEqual(["pay_late"]);
  });

  it("refunds a late charge only once", () => {
    const plan = planRecurringSync(
      local({ status: "cancelled", cancelledAt: REQUESTED }),
      remote("cancelled", { endedAt: REQUESTED }),
      [charge("pay_late", CYCLE_3)],
      context({ handledPaymentIds: new Set(["pay_late"]) })
    );
    expect(plan.refundAfterCancel).toEqual([]);
  });

  it("uses the gateway's end time when the gateway cancelled on its own", () => {
    const ended = at("2027-02-25T00:00:00.000Z");
    const plan = planRecurringSync(
      local(),
      remote("cancelled", { endedAt: ended }),
      [charge("pay_2", CYCLE_2), charge("pay_3", CYCLE_3)],
      context()
    );
    expect(plan.move?.to).toBe("cancelled");
    expect(ids(plan.record)).toEqual(["pay_2"]);
    expect(ids(plan.refundAfterCancel)).toEqual(["pay_3"]);
  });
});

describe("abandoned and finished mandates", () => {
  it("cancels a mandate nobody authorised within the window", () => {
    const plan = planRecurringSync(
      local({ status: "pending_authorisation" }),
      remote("created", { currentStart: null }),
      [],
      context({ now: new Date(STARTED.getTime() + 24 * HOUR) })
    );
    expect(plan.cancelAtGateway).toBe("abandoned");
  });

  it("waits until the window has passed", () => {
    const plan = planRecurringSync(
      local({ status: "pending_authorisation" }),
      remote("created", { currentStart: null }),
      [],
      context({ now: new Date(STARTED.getTime() + 24 * HOUR - 1) })
    );
    expect(plan.cancelAtGateway).toBeNull();
  });

  it("cancels when the gateway let the authorisation expire", () => {
    const plan = planRecurringSync(
      local({ status: "pending_authorisation" }),
      remote("expired", { currentStart: null, chargeAt: null }),
      [],
      context()
    );
    expect(plan.move).toEqual({
      event: "authorisation_expired",
      from: "pending_authorisation",
      to: "cancelled",
    });
  });

  it("completes after the last cycle and still records its charge", () => {
    const plan = planRecurringSync(
      local(),
      remote("completed", { chargeAt: null, endedAt: CYCLE_3 }),
      [charge("pay_last", CYCLE_3)],
      context()
    );
    expect(plan.move).toEqual({
      event: "completed",
      from: "active",
      to: "completed",
    });
    expect(ids(plan.record)).toEqual(["pay_last"]);
    expect(plan.nextChargeAt).toBeNull();
  });
});

describe("states the mirror can't follow", () => {
  it.each(["paused", "resumed", "something_new"])(
    "flags %s for review and changes nothing",
    (status) => {
      const plan = planRecurringSync(local(), remote(status), [], context());
      expect(plan.conflict).toEqual({ remoteStatus: status });
      expect(plan.move).toBeNull();
      expect(plan.nextChargeAt).toBeNull();
    }
  );

  it("flags a cancelled donation the gateway still calls active", () => {
    const plan = planRecurringSync(
      local({ status: "cancelled", cancelledAt: CYCLE_2 }),
      remote("active"),
      [],
      context()
    );
    expect(plan.conflict).toEqual({ remoteStatus: "active" });
    expect(plan.status).toBe("cancelled");
  });

  it("flags an active donation the gateway calls unauthorised", () => {
    const plan = planRecurringSync(local(), remote("created"), [], context());
    expect(plan.conflict).toEqual({ remoteStatus: "created" });
  });
});
