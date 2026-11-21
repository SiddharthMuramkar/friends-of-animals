// What anonymising a row means (#114): the inventory says, column by
// column, whether expiry nulls it or overwrites it with a placeholder, so
// an anonymise policy blanks exactly the personal data the inventory lists
// and nothing else. The row itself stays (counts, money, history).
//
// Pure, and loads under plain Node.

import type { InventoryEntry } from "./coverage";

/** Overwrites a required text column. Names no one. */
export const TOMBSTONE = "[removed]";

/**
 * The column values (by SQL name) that anonymise one row of `table`.
 * Throws when the inventory gives the table nothing to blank, which means
 * an anonymise policy points at the wrong table.
 */
export function anonymisePatch(
  inventory: readonly InventoryEntry[],
  table: string
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const entry of inventory) {
    if (entry.table !== table) continue;
    if (entry.onExpiry === "set_null") patch[entry.column] = null;
    if (entry.onExpiry === "tombstone") patch[entry.column] = TOMBSTONE;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error(
      `The inventory marks no column of "${table}" to null or tombstone on expiry, so it can't be anonymised`
    );
  }
  return patch;
}
