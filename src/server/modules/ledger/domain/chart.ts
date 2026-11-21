// The chart of accounts. Every ledger line lands on one account; an
// account's kind says which side grows it. "Categories" in the finance
// screens are the income and expense accounts: finance adds, renames,
// relabels and deactivates those. System accounts are the ones posting
// rules write to, so nobody may change them.
//
// The seeded chart is a default for FOA's accountant to confirm (HR-47).
// A custom migration inserts the same accounts into every database, since
// production needs them as much as a preview does. Pure: no I/O.

import type { Side } from "./posting";

export const ACCOUNT_KINDS = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** How the transparency page (#110) groups income and expense accounts. */
export const PUBLIC_GROUPS = [
  "income",
  "programs",
  "fundraising",
  "administration",
] as const;

export type PublicGroup = (typeof PUBLIC_GROUPS)[number];

const NORMAL_SIDE: Record<AccountKind, Side> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
  expense: "debit",
};

/** The side that grows an account of this kind. */
export function normalSide(kind: AccountKind): Side {
  return NORMAL_SIDE[kind];
}

/** An account's balance in its own direction: positive is normal. */
export function balanceOf(
  kind: AccountKind,
  totals: { debitMinor: bigint; creditMinor: bigint }
): bigint {
  const net = totals.debitMinor - totals.creditMinor;
  return normalSide(kind) === "debit" ? net : -net;
}

/** The accounts posting rules write to, by role. */
export const SYSTEM_ACCOUNT_CODES = {
  bank: "1000",
  cash: "1010",
  gatewayClearing: "1100",
  accumulatedFund: "3000",
  registrationFees: "4100",
} as const;

export type SeededAccount = {
  code: string;
  name: string;
  kind: AccountKind;
  isSystem: boolean;
  /** Income and expense accounts only; the others never appear publicly. */
  publicGroup: PublicGroup | null;
};

/** The chart every database starts with (HR-47 confirms codes and names). */
export const SEEDED_ACCOUNTS: readonly SeededAccount[] = [
  {
    code: "1000",
    name: "Bank account",
    kind: "asset",
    isSystem: true,
    publicGroup: null,
  },
  {
    code: "1010",
    name: "Cash in hand",
    kind: "asset",
    isSystem: true,
    publicGroup: null,
  },
  {
    code: "1100",
    name: "Payment gateway clearing",
    kind: "asset",
    isSystem: true,
    publicGroup: null,
  },
  {
    code: "3000",
    name: "Accumulated fund",
    kind: "equity",
    isSystem: true,
    publicGroup: null,
  },
  {
    code: "4100",
    name: "Registration fees",
    kind: "income",
    isSystem: true,
    publicGroup: "income",
  },
  {
    code: "4900",
    name: "Other income",
    kind: "income",
    isSystem: false,
    publicGroup: "income",
  },
  {
    code: "5100",
    name: "Prizes and awards",
    kind: "expense",
    isSystem: false,
    publicGroup: "programs",
  },
  {
    code: "5200",
    name: "Certificates and printing",
    kind: "expense",
    isSystem: false,
    publicGroup: "programs",
  },
  {
    code: "5300",
    name: "Logistics",
    kind: "expense",
    isSystem: false,
    publicGroup: "programs",
  },
  {
    code: "5400",
    name: "Platform and technology",
    kind: "expense",
    isSystem: false,
    publicGroup: "administration",
  },
  {
    code: "5500",
    name: "Payment gateway fees",
    kind: "expense",
    isSystem: false,
    publicGroup: "administration",
  },
  {
    code: "5600",
    name: "Events and outreach",
    kind: "expense",
    isSystem: false,
    publicGroup: "programs",
  },
  {
    code: "5900",
    name: "Other expenses",
    kind: "expense",
    isSystem: false,
    publicGroup: "administration",
  },
];

/** The kinds finance may create: income and expense categories. */
export const CATEGORY_KINDS = [
  "income",
  "expense",
] as const satisfies readonly AccountKind[];

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Codes are four digits; the first digit is the kind (1 asset … 5 expense). */
const CODE = /^\d{4}$/;
const MAX_NAME_LENGTH = 80;

function codeMatchesKind(code: string, kind: AccountKind): boolean {
  return code[0] === String(ACCOUNT_KINDS.indexOf(kind) + 1);
}

function cleanName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH
    ? trimmed
    : null;
}

export type NewCategoryCheck =
  | { ok: true; name: string }
  | {
      ok: false;
      error:
        | "kind_not_allowed"
        | "invalid_code"
        | "code_out_of_range"
        | "invalid_name";
    };

/** Whether finance may add this category. The code's uniqueness is the database's. */
export function checkNewCategory(input: {
  code: string;
  name: string;
  kind: AccountKind;
}): NewCategoryCheck {
  if (!(CATEGORY_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: "kind_not_allowed" };
  }
  if (!CODE.test(input.code)) return { ok: false, error: "invalid_code" };
  if (!codeMatchesKind(input.code, input.kind)) {
    return { ok: false, error: "code_out_of_range" };
  }
  const name = cleanName(input.name);
  if (name === null) return { ok: false, error: "invalid_name" };
  return { ok: true, name };
}

/** What finance may change on a category. Kind and code never change. */
export type AccountChange = {
  name?: string;
  isActive?: boolean;
  publicLabel?: string;
  publicGroup?: PublicGroup;
};

export type AccountChangeCheck =
  | { ok: true; change: AccountChange }
  | {
      ok: false;
      error:
        | "system_account"
        | "no_change"
        | "invalid_name"
        | "invalid_public_label"
        | "invalid_public_group";
    };

export function checkAccountChange(
  account: { isSystem: boolean; isActive: boolean },
  change: AccountChange
): AccountChangeCheck {
  if (account.isSystem) return { ok: false, error: "system_account" };
  const clean: AccountChange = {};
  if (change.name !== undefined) {
    const name = cleanName(change.name);
    if (name === null) return { ok: false, error: "invalid_name" };
    clean.name = name;
  }
  if (change.publicLabel !== undefined) {
    const label = cleanName(change.publicLabel);
    if (label === null) return { ok: false, error: "invalid_public_label" };
    clean.publicLabel = label;
  }
  if (change.publicGroup !== undefined) {
    if (!(PUBLIC_GROUPS as readonly string[]).includes(change.publicGroup)) {
      return { ok: false, error: "invalid_public_group" };
    }
    clean.publicGroup = change.publicGroup;
  }
  if (change.isActive !== undefined) clean.isActive = change.isActive;
  if (Object.keys(clean).length === 0) return { ok: false, error: "no_change" };
  return { ok: true, change: clean };
}
