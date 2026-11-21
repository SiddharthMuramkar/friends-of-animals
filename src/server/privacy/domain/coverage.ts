// The data inventory's coverage rule (#114). Every column in the schema is
// classified exactly once: as personal data, with an inventory entry saying
// why FOA holds it, whose it is, how long it stays and what happens when it
// expires; or as not personal, on an explicit per-table column list. A new
// column on either side fails the coverage test until someone classifies
// it, so the inventory can't fall behind the schema.
//
// Pure, and loads under plain Node.

import type { SchemaColumn } from "./schema-columns";

/** The lawful ground for holding the data (DPDP Act 2023, ss. 6-7). */
export type LegalBasis = "consent" | "legitimate_use" | "legal_obligation";

export type PersonalDataCategory =
  | "identity"
  | "contact"
  | "demographic"
  | "financial"
  | "content"
  | "technical";

/** What retention does to the column once its policy says it has expired. */
export type OnExpiry =
  /** The whole row goes. */
  | "delete_row"
  /** The column is set to null; the row stays. */
  | "set_null"
  /** The column is overwritten with a fixed placeholder; the row stays. */
  | "tombstone"
  /** Kept by design (an append-only table); the run reports it. */
  | "retain";

export type InventoryEntry = {
  table: string;
  column: string;
  category: PersonalDataCategory;
  /** Why FOA holds it, in plain words. */
  purpose: string;
  /**
   * Whose data it is, and the column (or path) that links the row to them,
   * so rights requests can find and erase it.
   */
  subject: { kind: string; via: string };
  retention: {
    /** The retention policy's key (its setting is `retention.<key>.days`). */
    policy: string;
    /** The period in words, for the inventory document. */
    period: string;
    basis: LegalBasis;
    /** Every period waits for counsel (HR-31). */
    toConfirm: true;
  };
  onExpiry: OnExpiry;
};

/** Columns that hold no personal data, by table. No wildcards. */
export type NonPersonalColumns = Readonly<Record<string, readonly string[]>>;

type Where = { table: string; column: string };
type List = "inventory" | "non_personal";

export type CoverageProblem =
  | ({ kind: "unclassified" } & Where)
  | ({ kind: "stale"; list: List } & Where)
  | ({ kind: "double_classified" } & Where)
  | ({ kind: "duplicate"; list: List } & Where)
  | ({ kind: "unknown_policy"; policy: string } & Where)
  | ({
      kind: "missing_detail";
      field: "purpose" | "subject" | "period";
    } & Where)
  | ({ kind: "encrypted_not_personal" } & Where)
  | ({ kind: "set_null_on_not_null" } & Where);

function key({ table, column }: Where): string {
  return `${table}.${column}`;
}

/** Duplicates in `items`, each reported once, in first-seen order. */
function duplicates(items: readonly Where[], list: List): CoverageProblem[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const problems: CoverageProblem[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id) && !reported.has(id)) {
      reported.add(id);
      problems.push({
        kind: "duplicate",
        list,
        table: item.table,
        column: item.column,
      });
    }
    seen.add(id);
  }
  return problems;
}

function blank(text: string): boolean {
  return text.trim() === "";
}

/**
 * Every way the inventory and the non-personal list disagree with the
 * schema, or with themselves. An empty array means full coverage.
 */
export function checkInventoryCoverage(input: {
  columns: readonly SchemaColumn[];
  inventory: readonly InventoryEntry[];
  nonPersonal: NonPersonalColumns;
  /** Every retention policy key an entry may name. */
  policies: ReadonlySet<string>;
}): CoverageProblem[] {
  const { columns, inventory, policies } = input;
  const nonPersonal: Where[] = Object.entries(input.nonPersonal).flatMap(
    ([table, names]) => names.map((column) => ({ table, column }))
  );
  const personalByKey = new Map(inventory.map((entry) => [key(entry), entry]));
  const nonPersonalKeys = new Set(nonPersonal.map(key));
  const schemaKeys = new Set(columns.map(key));

  const problems: CoverageProblem[] = [
    ...duplicates(inventory, "inventory"),
    ...duplicates(nonPersonal, "non_personal"),
  ];

  for (const column of columns) {
    const where = { table: column.table, column: column.column };
    const entry = personalByKey.get(key(column));
    const listedNonPersonal = nonPersonalKeys.has(key(column));
    if (entry && listedNonPersonal) {
      problems.push({ kind: "double_classified", ...where });
    } else if (!entry && !listedNonPersonal) {
      problems.push({ kind: "unclassified", ...where });
    }
    if (listedNonPersonal && column.column.endsWith("_ciphertext")) {
      problems.push({ kind: "encrypted_not_personal", ...where });
    }
    if (entry?.onExpiry === "set_null" && column.notNull) {
      problems.push({ kind: "set_null_on_not_null", ...where });
    }
  }

  for (const [list, items] of [
    ["inventory", inventory],
    ["non_personal", nonPersonal],
  ] as const) {
    const reported = new Set<string>();
    for (const item of items) {
      const id = key(item);
      if (schemaKeys.has(id) || reported.has(id)) continue;
      reported.add(id);
      problems.push({
        kind: "stale",
        list,
        table: item.table,
        column: item.column,
      });
    }
  }

  for (const entry of inventory) {
    const where = { table: entry.table, column: entry.column };
    if (!policies.has(entry.retention.policy)) {
      problems.push({
        kind: "unknown_policy",
        ...where,
        policy: entry.retention.policy,
      });
    }
    if (blank(entry.purpose)) {
      problems.push({ kind: "missing_detail", ...where, field: "purpose" });
    }
    if (blank(entry.subject.kind) || blank(entry.subject.via)) {
      problems.push({ kind: "missing_detail", ...where, field: "subject" });
    }
    if (blank(entry.retention.period)) {
      problems.push({ kind: "missing_detail", ...where, field: "period" });
    }
  }

  return problems;
}
