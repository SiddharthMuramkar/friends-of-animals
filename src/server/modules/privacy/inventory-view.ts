import { authorize, type PolicyContext } from "../../access/can";
import { INVENTORY_VIEW_ENTRIES, type InventoryViewEntry } from "./inventory";

export type InventoryView = {
  /** Catalogue metadata by SQL table and column. */
  entries: readonly InventoryViewEntry[];
};

export async function getInventory(ctx: PolicyContext): Promise<InventoryView> {
  await authorize(ctx, "privacy.inventory.view");
  return {
    entries: [...INVENTORY_VIEW_ENTRIES].sort(
      (a, b) =>
        a.table.localeCompare(b.table) || a.column.localeCompare(b.column)
    ),
  };
}
