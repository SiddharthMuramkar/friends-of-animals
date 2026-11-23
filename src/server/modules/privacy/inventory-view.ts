import { authorize, type PolicyContext } from "../../access/can";
import { DATA_INVENTORY, type InventoryEntry } from "./inventory";

export type InventoryView = {
  /** Catalogue metadata by SQL table and column. */
  entries: readonly InventoryEntry[];
};

export async function getInventory(ctx: PolicyContext): Promise<InventoryView> {
  await authorize(ctx, "privacy.inventory.view");
  return {
    entries: [...DATA_INVENTORY].sort(
      (a, b) =>
        a.table.localeCompare(b.table) || a.column.localeCompare(b.column)
    ),
  };
}
