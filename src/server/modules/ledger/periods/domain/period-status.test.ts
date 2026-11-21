import { describe, expect, it } from "vitest";

import {
  assertLedgerPeriodTransition,
  canTransitionLedgerPeriod,
  checkPeriodLock,
  checkPeriodUnlock,
  isPeriodClosed,
  LEDGER_PERIOD_STATUSES,
  LedgerPeriodTransitionError,
  lockLine,
  postingPeriodFor,
  type KnownPeriod,
  type LedgerPeriodStatus,
} from "./period-status";

// The expected machine, written out by hand. A ticket that adds a
// transition adds its row here and in the module's table.
const ALLOWED: readonly (readonly [
  LedgerPeriodStatus | null,
  LedgerPeriodStatus,
])[] = [
  // A month's first posting, or a lock request for a month with none yet.
  [null, "open"],
  // Locked once a second finance user approves the lock.
  ["open", "locked"],
  // Reopened once a second finance user approves an unlock with a reason.
  ["locked", "open"],
];

const FROM: readonly (LedgerPeriodStatus | null)[] = [null, "open", "locked"];

const PAIRS = FROM.flatMap((from) =>
  LEDGER_PERIOD_STATUSES.map((to) => ({
    from,
    to,
    allowed: ALLOWED.some(([f, t]) => f === from && t === to),
  }))
);

describe("ledger period status transitions", () => {
  it("has exactly the two statuses", () => {
    expect(LEDGER_PERIOD_STATUSES).toEqual(["open", "locked"]);
  });

  it.each(PAIRS)("$from -> $to allowed: $allowed", ({ from, to, allowed }) => {
    expect(canTransitionLedgerPeriod(from, to)).toBe(allowed);
    if (allowed) {
      expect(() => assertLedgerPeriodTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertLedgerPeriodTransition(from, to)).toThrow(
        LedgerPeriodTransitionError
      );
    }
  });

  it("names both ends in the error", () => {
    expect(() => assertLedgerPeriodTransition("locked", "locked")).toThrow(
      /locked -> locked/
    );
  });
});

const NOW = new Date("2026-11-21T10:00:00.000Z"); // 21 Nov 2026, IST

const periods = (
  ...entries: (readonly [string, LedgerPeriodStatus])[]
): KnownPeriod[] => entries.map(([month, status]) => ({ month, status }));

describe("lockLine: the latest locked month", () => {
  it("is null when nothing is locked", () => {
    expect(lockLine([])).toBeNull();
    expect(lockLine(periods(["2026-09", "open"]))).toBeNull();
  });

  it("is the latest locked month, in any input order", () => {
    expect(
      lockLine(
        periods(
          ["2026-10", "locked"],
          ["2026-11", "open"],
          ["2026-09", "locked"]
        )
      )
    ).toBe("2026-10");
  });
});

describe("isPeriodClosed", () => {
  const known = periods(["2026-09", "locked"], ["2026-10", "locked"]);

  it("is true for a locked month and for any month before the lock line", () => {
    expect(isPeriodClosed("2026-10", known)).toBe(true);
    expect(isPeriodClosed("2026-09", known)).toBe(true);
    // No row, but earlier than a locked month: closed too.
    expect(isPeriodClosed("2026-03", known)).toBe(true);
  });

  it("is false after the lock line, with or without a row", () => {
    expect(isPeriodClosed("2026-11", known)).toBe(false);
    expect(isPeriodClosed("2027-02", known)).toBe(false);
    expect(isPeriodClosed("2026-11", [])).toBe(false);
  });
});

describe("checkPeriodLock", () => {
  it("allows locking the current month once it has begun", () => {
    expect(
      checkPeriodLock({
        month: "2026-11",
        periods: periods(["2026-10", "locked"], ["2026-11", "open"]),
        now: NOW,
      })
    ).toEqual({ ok: true });
  });

  it("allows locking a month that has no row yet", () => {
    expect(
      checkPeriodLock({ month: "2026-10", periods: [], now: NOW })
    ).toEqual({ ok: true });
  });

  it("refuses a month that hasn't begun", () => {
    expect(
      checkPeriodLock({ month: "2026-12", periods: [], now: NOW })
    ).toEqual({ ok: false, reason: "period_not_started" });
  });

  it("refuses a month that is already closed", () => {
    const known = periods(["2026-09", "locked"], ["2026-10", "locked"]);
    expect(
      checkPeriodLock({ month: "2026-10", periods: known, now: NOW })
    ).toEqual({ ok: false, reason: "period_locked" });
    expect(
      checkPeriodLock({ month: "2026-08", periods: known, now: NOW })
    ).toEqual({ ok: false, reason: "period_locked" });
  });

  it("refuses to skip an earlier open month, so locked months stay a prefix", () => {
    expect(
      checkPeriodLock({
        month: "2026-11",
        periods: periods(["2026-09", "locked"], ["2026-10", "open"]),
        now: NOW,
      })
    ).toEqual({ ok: false, reason: "earlier_period_open", month: "2026-10" });
  });

  it("refuses something that isn't a month", () => {
    expect(() =>
      checkPeriodLock({ month: "2026-13", periods: [], now: NOW })
    ).toThrow(RangeError);
  });
});

describe("checkPeriodUnlock", () => {
  const known = periods(["2026-09", "locked"], ["2026-10", "locked"]);

  it("allows unlocking the latest locked month", () => {
    expect(checkPeriodUnlock({ month: "2026-10", periods: known })).toEqual({
      ok: true,
    });
  });

  it("refuses a month that isn't locked", () => {
    expect(checkPeriodUnlock({ month: "2026-11", periods: known })).toEqual({
      ok: false,
      reason: "period_not_locked",
    });
    expect(
      checkPeriodUnlock({
        month: "2026-11",
        periods: periods(["2026-11", "open"]),
      })
    ).toEqual({ ok: false, reason: "period_not_locked" });
  });

  it("refuses a month with a later locked month after it", () => {
    expect(checkPeriodUnlock({ month: "2026-09", periods: known })).toEqual({
      ok: false,
      reason: "later_period_locked",
      month: "2026-10",
    });
  });
});

describe("postingPeriodFor", () => {
  const known = periods(["2026-09", "locked"], ["2026-10", "locked"]);

  it("keeps a posting in its own month when that month is open", () => {
    expect(postingPeriodFor({ month: "2026-11", periods: known })).toEqual({
      periodMonth: "2026-11",
      lateAdjustment: false,
      originalPeriodMonth: null,
    });
    expect(postingPeriodFor({ month: "2026-04", periods: [] })).toEqual({
      periodMonth: "2026-04",
      lateAdjustment: false,
      originalPeriodMonth: null,
    });
  });

  it("moves a posting for a closed month to the first month after the lock line", () => {
    expect(postingPeriodFor({ month: "2026-09", periods: known })).toEqual({
      periodMonth: "2026-11",
      lateAdjustment: true,
      originalPeriodMonth: "2026-09",
    });
    expect(postingPeriodFor({ month: "2026-10", periods: known })).toEqual({
      periodMonth: "2026-11",
      lateAdjustment: true,
      originalPeriodMonth: "2026-10",
    });
  });

  it("crosses the year when December is the lock line", () => {
    expect(
      postingPeriodFor({
        month: "2026-12",
        periods: periods(["2026-12", "locked"]),
      })
    ).toEqual({
      periodMonth: "2027-01",
      lateAdjustment: true,
      originalPeriodMonth: "2026-12",
    });
  });
});
