import type { UseCaseContext } from "../../use-cases";
import { getInventory } from "./inventory-view";

export type { InventoryView } from "./inventory-view";

export const privacyUseCases = (ctx: UseCaseContext) => ({
  getInventory: () => getInventory(ctx),
});
