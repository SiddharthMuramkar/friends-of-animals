import { describe, expect, it } from "vitest";

import {
  ACCOUNT_KINDS,
  balanceOf,
  checkAccountChange,
  checkNewCategory,
  normalSide,
  SEEDED_ACCOUNTS,
  SYSTEM_ACCOUNT_CODES,
} from "./chart";

describe("normalSide() and balanceOf()", () => {
  it("grows assets and expenses with debits, everything else with credits", () => {
    expect(ACCOUNT_KINDS.map((kind) => [kind, normalSide(kind)])).toEqual([
      ["asset", "debit"],
      ["liability", "credit"],
      ["equity", "credit"],
      ["income", "credit"],
      ["expense", "debit"],
    ]);
  });

  it("reads a balance in the account's own direction", () => {
    const totals = { debitMinor: 1000n, creditMinor: 300n };
    expect(balanceOf("asset", totals)).toBe(700n);
    expect(balanceOf("expense", totals)).toBe(700n);
    expect(balanceOf("income", totals)).toBe(-700n);
    expect(balanceOf("income", { debitMinor: 300n, creditMinor: 1000n })).toBe(
      700n
    );
  });
});

describe("the seeded chart", () => {
  it("has unique codes, each inside its kind's range", () => {
    const codes = SEEDED_ACCOUNTS.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const account of SEEDED_ACCOUNTS) {
      expect(account.code[0], account.code).toBe(
        String(ACCOUNT_KINDS.indexOf(account.kind) + 1)
      );
    }
  });

  it("marks every account a posting rule uses as a system account", () => {
    for (const code of Object.values(SYSTEM_ACCOUNT_CODES)) {
      const account = SEEDED_ACCOUNTS.find((seeded) => seeded.code === code);
      expect(account?.isSystem, code).toBe(true);
    }
  });

  it("gives income and expense accounts a public group, and no other kind", () => {
    for (const account of SEEDED_ACCOUNTS) {
      const shown = account.kind === "income" || account.kind === "expense";
      expect(account.publicGroup !== null, account.code).toBe(shown);
    }
    expect(
      SEEDED_ACCOUNTS.filter((account) => account.kind === "income").map(
        (account) => account.publicGroup
      )
    ).toEqual(expect.arrayContaining(["income"]));
  });
});

describe("checkNewCategory()", () => {
  it("lets finance add an income or expense account in its range", () => {
    expect(
      checkNewCategory({ code: "4300", name: "Sponsorships", kind: "income" })
    ).toEqual({ ok: true, name: "Sponsorships" });
    expect(
      checkNewCategory({
        code: "5950",
        name: "  Bank charges ",
        kind: "expense",
      })
    ).toEqual({ ok: true, name: "Bank charges" });
  });

  it.each(["asset", "liability", "equity"] as const)(
    "refuses a new %s account: only income and expense categories are finance's",
    (kind) => {
      expect(checkNewCategory({ code: "1200", name: "X", kind })).toEqual({
        ok: false,
        error: "kind_not_allowed",
      });
    }
  );

  it.each(["430", "43000", "4a00", "", " 4300"])(
    "refuses the code %j",
    (code) => {
      expect(checkNewCategory({ code, name: "X", kind: "income" })).toEqual({
        ok: false,
        error: "invalid_code",
      });
    }
  );

  it("refuses a code outside the kind's range", () => {
    expect(
      checkNewCategory({ code: "5300", name: "X", kind: "income" })
    ).toEqual({ ok: false, error: "code_out_of_range" });
    expect(
      checkNewCategory({ code: "4300", name: "X", kind: "expense" })
    ).toEqual({ ok: false, error: "code_out_of_range" });
  });

  it("refuses an empty or overlong name", () => {
    expect(
      checkNewCategory({ code: "4300", name: "   ", kind: "income" })
    ).toEqual({ ok: false, error: "invalid_name" });
    expect(
      checkNewCategory({ code: "4300", name: "x".repeat(81), kind: "income" })
    ).toEqual({ ok: false, error: "invalid_name" });
  });
});

describe("checkAccountChange()", () => {
  const category = { isSystem: false, isActive: true };

  it("lets finance rename, relabel and deactivate a category", () => {
    expect(checkAccountChange(category, { name: " Travel " })).toEqual({
      ok: true,
      change: { name: "Travel" },
    });
    expect(checkAccountChange(category, { isActive: false })).toEqual({
      ok: true,
      change: { isActive: false },
    });
    expect(
      checkAccountChange(category, {
        publicLabel: "Programmes",
        publicGroup: "programs",
      })
    ).toEqual({
      ok: true,
      change: { publicLabel: "Programmes", publicGroup: "programs" },
    });
  });

  it("refuses any change to a system account, which posting rules depend on", () => {
    expect(
      checkAccountChange({ isSystem: true, isActive: true }, { name: "Bank 2" })
    ).toEqual({ ok: false, error: "system_account" });
    expect(
      checkAccountChange(
        { isSystem: true, isActive: true },
        { isActive: false }
      )
    ).toEqual({ ok: false, error: "system_account" });
  });

  it("refuses an empty change, a bad name and an unknown public group", () => {
    expect(checkAccountChange(category, {})).toEqual({
      ok: false,
      error: "no_change",
    });
    expect(checkAccountChange(category, { name: "" })).toEqual({
      ok: false,
      error: "invalid_name",
    });
    expect(
      checkAccountChange(category, { publicGroup: "salaries" as never })
    ).toEqual({ ok: false, error: "invalid_public_group" });
  });
});
