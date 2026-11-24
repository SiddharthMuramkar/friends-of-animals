// The Privacy module's use cases (#114): the data inventory, the retention
// sweep and legal holds. Export and erasure (#115a, #115b) join here.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { UseCaseContext } from "../../use-cases";
import { listLegalHolds, placeLegalHold, releaseLegalHold } from "./holds";
import type { PlaceLegalHoldInput } from "./hold-input";
import { getInventory } from "./inventory-view";
import { previewRetentionSweep, runRetentionSweep } from "./sweep";

export type { LegalHoldPage } from "./holds";
export type { InventoryView, RetentionPolicyView } from "./inventory-view";
export type { RetentionRunSummary } from "./domain/retention-plan";

export const privacyUseCases = (ctx: UseCaseContext) => ({
  runRetentionSweep: () => runRetentionSweep(ctx),
  previewRetentionSweep: () => previewRetentionSweep(ctx),
  placeLegalHold: (input: PlaceLegalHoldInput) => placeLegalHold(ctx, input),
  releaseLegalHold: (input: { holdId: string }) => releaseLegalHold(ctx, input),
  listLegalHolds: (cursor?: string) => listLegalHolds(ctx, cursor),
  getInventory: () => getInventory(ctx),
});
