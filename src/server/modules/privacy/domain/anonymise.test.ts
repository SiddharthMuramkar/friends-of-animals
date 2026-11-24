import { describe, expect, it } from "vitest";

import { anonymisePatch, TOMBSTONE } from "./anonymise";
import type { InventoryEntry, OnExpiry } from "./coverage";

function entry(
  table: string,
  column: string,
  onExpiry: OnExpiry
): InventoryEntry {
  return {
    table,
    column,
    category: "contact",
    purpose: "Ask a guardian to approve a registration",
    subject: { kind: "guardian", via: "contact_hash" },
    retention: {
      policy: "guardianRequests",
      period: "30 days after the request is answered or expires",
      basis: "Needed to reach the person about their account",
      toConfirm: true,
    },
    onExpiry,
  };
}

const INVENTORY = [
  entry("guardian_invitation", "guardian_name", "tombstone"),
  entry("guardian_invitation", "contact_ciphertext", "set_null"),
  entry("guardian_invitation", "contact_hash", "set_null"),
  entry("guardian_invitation", "created_by", "retain"),
  entry("captured_message", "to_address", "delete_row"),
];

describe("anonymisePatch", () => {
  it("blanks one table's columns the way the inventory says", () => {
    expect(anonymisePatch(INVENTORY, "guardian_invitation")).toEqual({
      guardian_name: TOMBSTONE,
      contact_ciphertext: null,
      contact_hash: null,
    });
  });

  it("uses a placeholder that names no one", () => {
    expect(TOMBSTONE).toBe("[removed]");
  });

  it("refuses a table with nothing to anonymise", () => {
    expect(() => anonymisePatch(INVENTORY, "captured_message")).toThrow(
      /captured_message/
    );
    expect(() => anonymisePatch(INVENTORY, "payment")).toThrow(/payment/);
  });
});
