import { describe, expect, it } from "vitest";

import {
  checkInventoryCoverage,
  type InventoryEntry,
  type NonPersonalColumns,
} from "./coverage";
import type { SchemaColumn } from "./schema-columns";

const COLUMNS: SchemaColumn[] = [
  { table: "user", column: "email", notNull: true },
  { table: "user", column: "id", notNull: true },
  { table: "user", column: "image", notNull: false },
];

function entry(
  column: string,
  overrides: Partial<InventoryEntry> = {}
): InventoryEntry {
  return {
    table: "user",
    column,
    category: "contact",
    purpose: "Sign-in codes and service messages",
    subject: { kind: "user", via: "id" },
    retention: {
      policy: "accountLifetime",
      period: "Until the account is erased",
      basis: "Needed to reach the person about their account",
      toConfirm: true,
    },
    onExpiry: "delete_row",
    ...overrides,
  };
}

const POLICIES = new Set(["accountLifetime"]);

function check(
  inventory: InventoryEntry[],
  nonPersonal: NonPersonalColumns,
  columns: SchemaColumn[] = COLUMNS
) {
  return checkInventoryCoverage({
    columns,
    inventory,
    nonPersonal,
    policies: POLICIES,
  });
}

describe("checkInventoryCoverage", () => {
  it("passes when every column is either personal data or listed as not", () => {
    expect(check([entry("email"), entry("image")], { user: ["id"] })).toEqual(
      []
    );
  });

  it("fails on a column nobody classified", () => {
    expect(check([entry("email")], { user: ["id"] })).toEqual([
      { kind: "unclassified", table: "user", column: "image" },
    ]);
  });

  it("fails on an entry for a column the schema no longer has", () => {
    expect(
      check([entry("email"), entry("image"), entry("phone")], {
        user: ["id", "legacy_flag"],
      })
    ).toEqual([
      { kind: "stale", list: "inventory", table: "user", column: "phone" },
      {
        kind: "stale",
        list: "non_personal",
        table: "user",
        column: "legacy_flag",
      },
    ]);
  });

  it("fails on a column that is on both lists", () => {
    expect(
      check([entry("email"), entry("image")], { user: ["id", "image"] })
    ).toEqual([{ kind: "double_classified", table: "user", column: "image" }]);
  });

  it("fails on a column listed twice", () => {
    expect(
      check([entry("email"), entry("image"), entry("email")], {
        user: ["id", "id"],
      })
    ).toEqual([
      { kind: "duplicate", list: "inventory", table: "user", column: "email" },
      { kind: "duplicate", list: "non_personal", table: "user", column: "id" },
    ]);
  });

  it("fails on an entry whose retention names no known policy", () => {
    const image = entry("image", {
      retention: { ...entry("image").retention, policy: "forever" },
    });
    expect(check([entry("email"), image], { user: ["id"] })).toEqual([
      {
        kind: "unknown_policy",
        table: "user",
        column: "image",
        policy: "forever",
      },
    ]);
  });

  it("fails on an entry without a purpose, a period, a basis or a subject path", () => {
    const blank = entry("image", {
      purpose: " ",
      subject: { kind: "user", via: "" },
      retention: { ...entry("image").retention, period: "", basis: " " },
    });
    expect(check([entry("email"), blank], { user: ["id"] })).toEqual([
      {
        kind: "missing_detail",
        table: "user",
        column: "image",
        field: "purpose",
      },
      {
        kind: "missing_detail",
        table: "user",
        column: "image",
        field: "subject",
      },
      {
        kind: "missing_detail",
        table: "user",
        column: "image",
        field: "period",
      },
      {
        kind: "missing_detail",
        table: "user",
        column: "image",
        field: "basis",
      },
    ]);
  });

  it("never lets an encrypted column count as non-personal", () => {
    const columns = [
      ...COLUMNS,
      { table: "user", column: "phone_ciphertext", notNull: false },
    ];
    expect(
      check(
        [entry("email"), entry("image")],
        { user: ["id", "phone_ciphertext"] },
        columns
      )
    ).toEqual([
      {
        kind: "encrypted_not_personal",
        table: "user",
        column: "phone_ciphertext",
      },
    ]);
  });

  it("fails when expiry would blank a column the schema requires", () => {
    expect(
      check([entry("email", { onExpiry: "set_null" }), entry("image")], {
        user: ["id"],
      })
    ).toEqual([
      { kind: "set_null_on_not_null", table: "user", column: "email" },
    ]);
  });

  it("never overwrites an encrypted column with a placeholder, which wouldn't decrypt", () => {
    const columns = [
      ...COLUMNS,
      { table: "user", column: "phone_ciphertext", notNull: true },
    ];
    expect(
      check(
        [
          entry("email"),
          entry("image"),
          entry("phone_ciphertext", { onExpiry: "tombstone" }),
        ],
        { user: ["id"] },
        columns
      )
    ).toEqual([
      {
        kind: "tombstone_on_encrypted",
        table: "user",
        column: "phone_ciphertext",
      },
    ]);
  });

  it("lets a nullable column be blanked on expiry", () => {
    expect(
      check([entry("email"), entry("image", { onExpiry: "set_null" })], {
        user: ["id"],
      })
    ).toEqual([]);
  });

  it("names every unclassified column of a new table", () => {
    const columns = [
      ...COLUMNS,
      { table: "pet", column: "id", notNull: true },
      { table: "pet", column: "owner_name", notNull: true },
    ];
    expect(
      check([entry("email"), entry("image")], { user: ["id"] }, columns)
    ).toEqual([
      { kind: "unclassified", table: "pet", column: "id" },
      { kind: "unclassified", table: "pet", column: "owner_name" },
    ]);
  });
});
