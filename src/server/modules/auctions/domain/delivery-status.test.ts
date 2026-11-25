import { describe, expect, it } from "vitest";

import {
  DELIVERY_COMMANDS,
  DELIVERY_COMMAND_ACTOR,
  DELIVERY_STATUSES,
  decideDeliveryTransition,
} from "./delivery-status";

describe("decideDeliveryTransition", () => {
  const allowed: Record<string, string> = {
    "awaiting_address:save_address": "pending_dispatch",
    "pending_dispatch:save_address": "pending_dispatch",
    "pending_dispatch:dispatch": "dispatched",
    "dispatched:update_tracking": "dispatched",
    "dispatched:mark_delivered": "delivered",
    "dispatched:confirm_receipt": "receipt_confirmed",
    "delivered:confirm_receipt": "receipt_confirmed",
    "delivered:record_receipt": "receipt_confirmed",
  };
  const addressLocked = new Set([
    "dispatched:save_address",
    "delivered:save_address",
    "receipt_confirmed:save_address",
  ]);

  it("allows only the listed moves, and locks the address once dispatched", () => {
    for (const from of DELIVERY_STATUSES) {
      for (const command of DELIVERY_COMMANDS) {
        const key = `${from}:${command}`;
        const to = allowed[key];
        const expected = to
          ? { ok: true, to }
          : {
              ok: false,
              error: addressLocked.has(key)
                ? "address_locked"
                : "transition_not_allowed",
            };
        expect(decideDeliveryTransition({ from, command })).toEqual(expected);
      }
    }
  });

  it("ends at confirmed receipt", () => {
    for (const command of DELIVERY_COMMANDS) {
      expect(
        decideDeliveryTransition({ from: "receipt_confirmed", command }).ok
      ).toBe(false);
    }
  });
});

describe("DELIVERY_COMMAND_ACTOR", () => {
  it("gives the address and receipt to the buyer, the rest to the auction manager", () => {
    expect(DELIVERY_COMMAND_ACTOR).toEqual({
      save_address: "buyer",
      dispatch: "manager",
      update_tracking: "manager",
      mark_delivered: "manager",
      confirm_receipt: "buyer",
      record_receipt: "manager",
    });
  });
});
