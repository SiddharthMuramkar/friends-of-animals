// What erasing one data principal does to each of their rows (#115). The
// data inventory says, column by column, what expiry does (delete the row,
// null the column, overwrite it with a placeholder, or keep it because the
// table is append-only) and on what legal basis FOA holds it. Erasure
// follows the same entries, with three things that keep data:
//   - a legal hold on the subject keeps every row untouched;
//   - an append-only column (consent events, audit) keeps its row;
//   - a column held under a legal obligation (financial records) keeps its
//     row until the row's statutory floor lapses; until then only the
//     consented extras on that row are blanked.
// Everything kept is reported by category, so the request can end as
// `partially_completed` and say why.
//
// The officer previews the plan and approves its fingerprint; execution
// re-plans and refuses if the fingerprint moved, so what runs is what was
// approved. The fingerprint names actions and columns, never ids or counts.
//
// Pure, and loads under plain Node: the erasure job runs it.

import { createHash } from "node:crypto";

/**
 * The inventory fields erasure reads: a structural subset of #114's
 * `InventoryEntry`, so the inventory's entries can be passed in as they are.
 */
export type ErasureEntry = {
  table: string;
  column: string;
  category: string;
  retention: { basis: "consent" | "legitimate_use" | "legal_obligation" };
  onExpiry: "delete_row" | "set_null" | "tombstone" | "retain";
};

/** Overwrites a required text column. The same placeholder as retention's. */
export const ERASED = "[removed]";

/** One subject's rows in one table, as the table's resolver finds them. */
export type SubjectRows = {
  table: string;
  rows: readonly {
    id: string;
    /** When the row's statutory floor lapses; null when it has none. */
    floorLapsesAt: Date | null;
  }[];
};

export type RetainReason = "legal_hold" | "append_only" | "floor";

export type RetainedCategory = {
  table: string;
  category: string;
  reason: RetainReason;
  basis: ErasureEntry["retention"]["basis"];
  rows: number;
  /** The latest instant any of these rows may go; null when open-ended. */
  until: Date | null;
};

export type ColumnPatch = Record<string, string | null>;

export type TablePlan = {
  table: string;
  deleteRowIds: string[];
  /** Rows that stay, grouped by the columns they lose. */
  anonymise: { rowIds: string[]; patch: ColumnPatch }[];
  retained: RetainedCategory[];
};

export type ErasurePlan = {
  /** One plan per table that has rows for the subject, by table name. */
  tables: TablePlan[];
  /** Every category kept, across tables. */
  retained: RetainedCategory[];
  outcome: "completed" | "partially_completed";
  /** What the officer approves: actions and columns, no ids or counts. */
  fingerprint: string;
};

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function patchOf(entries: readonly ErasureEntry[]): ColumnPatch {
  const patch: ColumnPatch = {};
  for (const entry of [...entries].sort((a, b) => byName(a.column, b.column))) {
    if (entry.onExpiry === "set_null") patch[entry.column] = null;
    if (entry.onExpiry === "tombstone") patch[entry.column] = ERASED;
  }
  return patch;
}

/** Collects kept rows per (category, reason, basis). */
class RetainedTally {
  readonly #byKey = new Map<string, RetainedCategory>();

  constructor(private readonly table: string) {}

  add(
    entries: readonly ErasureEntry[],
    reason: RetainReason,
    until: Date | null,
    basisOverride?: ErasureEntry["retention"]["basis"]
  ): void {
    const seen = new Set<string>();
    for (const entry of entries) {
      const basis = basisOverride ?? entry.retention.basis;
      const key = `${entry.category}\u0000${reason}\u0000${basis}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = this.#byKey.get(key);
      if (current === undefined) {
        this.#byKey.set(key, {
          table: this.table,
          category: entry.category,
          reason,
          basis,
          rows: 1,
          until,
        });
      } else {
        current.rows += 1;
        if (current.until !== null && until !== null && until > current.until) {
          current.until = until;
        }
      }
    }
  }

  list(): RetainedCategory[] {
    return [...this.#byKey.values()].sort(
      (a, b) => byName(a.category, b.category) || byName(a.reason, b.reason)
    );
  }
}

function planTable(input: {
  now: Date;
  onLegalHold: boolean;
  entries: readonly ErasureEntry[];
  subject: SubjectRows;
}): TablePlan {
  const { now, onLegalHold, entries, subject } = input;
  const plan: TablePlan = {
    table: subject.table,
    deleteRowIds: [],
    anonymise: [],
    retained: [],
  };
  const tally = new RetainedTally(subject.table);
  const appendOnly = entries.filter((e) => e.onExpiry === "retain");
  const legal = entries.filter(
    (e) => e.onExpiry !== "retain" && e.retention.basis === "legal_obligation"
  );
  const deletesRow = entries.some((e) => e.onExpiry === "delete_row");
  const groups = new Map<string, { rowIds: string[]; patch: ColumnPatch }>();

  for (const row of subject.rows) {
    if (onLegalHold) {
      tally.add(entries, "legal_hold", null);
      continue;
    }
    const keptByFloor =
      legal.length > 0 && row.floorLapsesAt !== null && now < row.floorLapsesAt;
    if (appendOnly.length === 0 && !keptByFloor) {
      if (deletesRow) {
        plan.deleteRowIds.push(row.id);
        continue;
      }
    }
    if (appendOnly.length > 0) tally.add(appendOnly, "append_only", null);
    if (keptByFloor) {
      // Columns that would delete the row stay with it until the floor.
      const heldWithRow = entries.filter(
        (e) => e.onExpiry === "delete_row" && !legal.includes(e)
      );
      // Every legal entry's basis is legal_obligation already, so one call
      // counts the row once per category.
      tally.add(
        [...legal, ...heldWithRow],
        "floor",
        row.floorLapsesAt,
        "legal_obligation"
      );
    }
    const blankable = entries.filter(
      (e) => e.onExpiry !== "retain" && !(keptByFloor && legal.includes(e))
    );
    const patch = patchOf(blankable);
    if (Object.keys(patch).length === 0) continue;
    const key = JSON.stringify(patch);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { rowIds: [row.id], patch });
    else group.rowIds.push(row.id);
  }

  plan.anonymise = [...groups.values()];
  plan.retained = tally.list();
  return plan;
}

function fingerprintOf(tables: readonly TablePlan[]): string {
  const shape = tables.map((table) => ({
    table: table.table,
    delete: table.deleteRowIds.length > 0,
    anonymise: [
      ...new Set(
        table.anonymise.map((group) => Object.keys(group.patch).join(","))
      ),
    ].sort(byName),
    retained: table.retained.map(
      (kept) => `${kept.category}/${kept.reason}/${kept.basis}`
    ),
  }));
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

/**
 * The erasure plan for one subject at `now`. Throws if the subject has
 * rows in a table the inventory doesn't describe: erasure never guesses.
 */
export function planErasure(input: {
  now: Date;
  /** Whether a legal hold is in force on the subject. */
  onLegalHold: boolean;
  entries: readonly ErasureEntry[];
  subjectRows: readonly SubjectRows[];
}): ErasurePlan {
  const tables: TablePlan[] = [];
  for (const subject of [...input.subjectRows].sort((a, b) =>
    byName(a.table, b.table)
  )) {
    if (subject.rows.length === 0) continue;
    const entries = input.entries.filter((e) => e.table === subject.table);
    if (entries.length === 0) {
      throw new Error(
        `The data inventory has no entries for "${subject.table}", so its rows can't be erased`
      );
    }
    tables.push(
      planTable({
        now: input.now,
        onLegalHold: input.onLegalHold,
        entries,
        subject,
      })
    );
  }
  const retained = tables.flatMap((table) => table.retained);
  return {
    tables,
    retained,
    outcome: retained.length > 0 ? "partially_completed" : "completed",
    fingerprint: fingerprintOf(tables),
  };
}
