import { describe, expect, it } from "vitest";

import {
  CLUB_ACTIONS,
  CLUB_REASON_MAX_LENGTH,
  CLUB_STATUSES,
  decideClubStatus,
  holdsInstitutionPlace,
} from "./status";

const REASON = "Meets in the library on Fridays";

/** Room for one more club at the institution. */
const ROOM = { slotsHeld: 0, maxPerInstitution: 1 };

describe("club status transitions", () => {
  // Every status against every action: the moves not listed are refused.
  const allowed = {
    "applied approve": { to: "approved", outcome: "approved" },
    "applied decline": { to: "declined", outcome: "declined" },
    "applied withdraw": { to: "withdrawn", outcome: "withdrawn" },
    "approved suspend": { to: "suspended", outcome: "suspended" },
    "approved close": { to: "closed", outcome: "closed" },
    "suspended approve": { to: "approved", outcome: "reinstated" },
    "suspended close": { to: "closed", outcome: "closed" },
  } as const;

  const table = CLUB_STATUSES.flatMap((from) =>
    CLUB_ACTIONS.map((action) => ({ from, action }))
  );

  it("covers six statuses and five actions", () => {
    expect(CLUB_STATUSES).toEqual([
      "applied",
      "approved",
      "declined",
      "withdrawn",
      "suspended",
      "closed",
    ]);
    expect(CLUB_ACTIONS).toEqual([
      "approve",
      "decline",
      "withdraw",
      "suspend",
      "close",
    ]);
    expect(table).toHaveLength(30);
  });

  it.each(table)("$from + $action", ({ from, action }) => {
    const expected = allowed[`${from} ${action}` as keyof typeof allowed];
    const result = decideClubStatus({ from, action, reason: REASON, ...ROOM });
    if (expected) {
      expect(result).toMatchObject({ ok: true, ...expected });
    } else {
      expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    }
  });
});

describe("the clubs-per-institution limit", () => {
  it("refuses an approval when the institution is at its limit", () => {
    expect(
      decideClubStatus({
        from: "applied",
        action: "approve",
        reason: "",
        slotsHeld: 1,
        maxPerInstitution: 1,
      })
    ).toEqual({ ok: false, error: "club_limit_reached" });
  });

  it("allows it once the limit is raised", () => {
    expect(
      decideClubStatus({
        from: "applied",
        action: "approve",
        reason: "",
        slotsHeld: 1,
        maxPerInstitution: 2,
      })
    ).toMatchObject({ ok: true, to: "approved" });
  });

  it("reinstates a suspended club even at the limit: it already holds a place", () => {
    expect(
      decideClubStatus({
        from: "suspended",
        action: "approve",
        reason: "",
        slotsHeld: 1,
        maxPerInstitution: 1,
      })
    ).toMatchObject({ ok: true, to: "approved", outcome: "reinstated" });
  });

  it("never limits declining, withdrawing, suspending or closing", () => {
    const full = { reason: REASON, slotsHeld: 5, maxPerInstitution: 1 };
    expect(
      decideClubStatus({ from: "applied", action: "decline", ...full })
    ).toMatchObject({ ok: true });
    expect(
      decideClubStatus({ from: "applied", action: "withdraw", ...full })
    ).toMatchObject({ ok: true });
    expect(
      decideClubStatus({ from: "approved", action: "suspend", ...full })
    ).toMatchObject({ ok: true });
    expect(
      decideClubStatus({ from: "approved", action: "close", ...full })
    ).toMatchObject({ ok: true });
  });

  it("counts approved and suspended clubs as holding a place", () => {
    expect(CLUB_STATUSES.filter(holdsInstitutionPlace)).toEqual([
      "approved",
      "suspended",
    ]);
  });
});

describe("the reason for a change", () => {
  it.each([
    { from: "applied", action: "decline" },
    { from: "approved", action: "suspend" },
    { from: "approved", action: "close" },
  ] as const)("is required to $action", ({ from, action }) => {
    for (const reason of ["", "   ", "\n\t"]) {
      expect(decideClubStatus({ from, action, reason, ...ROOM })).toEqual({
        ok: false,
        error: "reason_required",
      });
    }
  });

  it("is optional to approve or withdraw, and stored as null when blank", () => {
    expect(
      decideClubStatus({
        from: "applied",
        action: "approve",
        reason: " ",
        ...ROOM,
      })
    ).toMatchObject({ ok: true, reason: null });
    expect(
      decideClubStatus({
        from: "applied",
        action: "withdraw",
        reason: "",
        ...ROOM,
      })
    ).toMatchObject({ ok: true, reason: null });
  });

  it("is trimmed as stored and shown", () => {
    expect(
      decideClubStatus({
        from: "applied",
        action: "decline",
        reason: `  ${REASON}\n`,
        ...ROOM,
      })
    ).toMatchObject({ ok: true, reason: REASON });
  });

  it("may be 1000 characters, not 1001", () => {
    const at = (length: number) =>
      decideClubStatus({
        from: "applied",
        action: "decline",
        reason: "a".repeat(length),
        ...ROOM,
      });
    expect(CLUB_REASON_MAX_LENGTH).toBe(1000);
    expect(at(1000)).toMatchObject({ ok: true });
    expect(at(1001)).toEqual({ ok: false, error: "reason_too_long" });
  });

  it("refuses a move that isn't allowed before looking at the reason", () => {
    expect(
      decideClubStatus({
        from: "closed",
        action: "decline",
        reason: "",
        ...ROOM,
      })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
  });
});
