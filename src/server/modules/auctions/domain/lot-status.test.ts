import { describe, expect, it } from "vitest";

import {
  ACTIVE_LOT_STATUSES,
  cancelsOnConsentWithdrawal,
  decideLotTransition,
  LOT_COMMANDS,
  LOT_STATUSES,
  PUBLIC_LOT_STATUSES,
} from "./lot-status";

describe("lot status transitions", () => {
  // The whole table: every move not listed here is refused, including the
  // ones bidding (#132) and payment (#133) add later.
  const allowed = {
    "draft schedule": { to: "scheduled", event: null, restoresArtwork: false },
    "draft cancel": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
    "draft withdraw_consent": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
    "scheduled open": {
      to: "open",
      event: "auction.lot_opened",
      restoresArtwork: false,
    },
    "scheduled cancel": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
    "scheduled withdraw_consent": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
    "open close": {
      to: "closed",
      event: "auction.lot_closed",
      restoresArtwork: false,
    },
    "open cancel": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
    "open withdraw_consent": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
    "closed settle_unsold": {
      to: "unsold",
      event: null,
      restoresArtwork: true,
    },
    "closed withdraw_consent": {
      to: "cancelled",
      event: "auction.lot_cancelled",
      restoresArtwork: true,
    },
  } as const;

  const table = LOT_STATUSES.flatMap((from) =>
    LOT_COMMANDS.map((command) => ({ from, command }))
  );

  it("covers nine statuses and six commands", () => {
    expect(LOT_STATUSES).toEqual([
      "draft",
      "scheduled",
      "open",
      "closed",
      "awaiting_payment",
      "sold",
      "unsold",
      "relisted",
      "cancelled",
    ]);
    expect(LOT_COMMANDS).toEqual([
      "schedule",
      "open",
      "close",
      "settle_unsold",
      "cancel",
      "withdraw_consent",
    ]);
    expect(table).toHaveLength(54);
  });

  it.each(table)("$from + $command", ({ from, command }) => {
    const expected = allowed[`${from} ${command}` as keyof typeof allowed];
    const result = decideLotTransition({ from, command });
    if (expected) {
      expect(result).toEqual({ ok: true, ...expected });
    } else {
      expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    }
  });

  it("leaves sold, unsold and cancelled lots where they are", () => {
    for (const from of ["sold", "unsold", "cancelled"] as const) {
      for (const command of LOT_COMMANDS) {
        expect(decideLotTransition({ from, command }).ok).toBe(false);
      }
    }
  });
});

describe("which lots", () => {
  it("the public sees: upcoming (scheduled) and open ones", () => {
    expect(PUBLIC_LOT_STATUSES).toEqual(["scheduled", "open"]);
  });

  it("hold their artwork: every lot not yet sold, unsold or cancelled", () => {
    expect(ACTIVE_LOT_STATUSES).toEqual([
      "draft",
      "scheduled",
      "open",
      "closed",
      "awaiting_payment",
      "relisted",
    ]);
  });

  it("withdrawing auction consent cancels, among those #131 runs", () => {
    expect(LOT_STATUSES.filter(cancelsOnConsentWithdrawal)).toEqual([
      "draft",
      "scheduled",
      "open",
      "closed",
    ]);
  });
});
