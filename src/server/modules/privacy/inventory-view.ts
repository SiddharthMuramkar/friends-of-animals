// The data inventory as staff read it (#114): every personal-data column
// with its purpose, subject and default retention, and every retention
// policy with the period that applies now. The privacy page
// (/admin/privacy) shows it; a staff admin or super admin reads it.
//
// Loads under plain Node: relative imports only, no "server-only".

import { authorize } from "../../access/can";
import type { UseCaseContext } from "../../use-cases";
import {
  CONTACT_RETENTION,
  minimumRetentionDays,
  RETENTION_PERIODS,
  retentionSettingKey,
  type RetentionPeriod,
} from "./domain/periods";
import type { RetentionAction } from "./domain/retention-plan";
import { INVENTORY_VIEW_ENTRIES, type InventoryViewEntry } from "./inventory";
import { LIFECYCLE_POLICY_KEYS, SWEPT_POLICIES } from "./policies";

export type InventoryContext = Pick<
  UseCaseContext,
  "db" | "clock" | "settings" | "actor"
>;

/** One retention policy, as the page explains it. */
export type RetentionPolicyView =
  | {
      key: string;
      kind: "timed";
      action: RetentionAction;
      /** The period that applies now, from its setting. */
      days: number;
      defaultDays: number;
      /** The lowest value its setting accepts: the floor's, or 1. */
      minimumDays: number;
      /** True for a statutory floor that no setting can shorten. */
      hasFloor: boolean;
    }
  | { key: string; kind: "fixed"; action: RetentionAction }
  | {
      key: string;
      kind: "calendar";
      action: RetentionAction;
      months: number;
      defaultMonths: number;
      minimumMonths: number;
    }
  | { key: string; kind: "lifecycle" };

export type InventoryView = {
  /** Catalogue metadata by SQL table and column. */
  entries: readonly InventoryViewEntry[];
  /** The swept policies in run order, then the lifecycle ones. */
  policies: RetentionPolicyView[];
  /** Whether the daily run deletes, or only counts (retention.enforce). */
  enforced: boolean;
  /** Whether the actor may manage holds and open the settings. */
  canManageRetention: boolean;
};

async function policyViews(
  ctx: InventoryContext
): Promise<RetentionPolicyView[]> {
  const policies: RetentionPolicyView[] = [];
  for (const policy of SWEPT_POLICIES) {
    if (policy.period.kind === "fixed") {
      policies.push({ key: policy.key, kind: "fixed", action: policy.action });
      continue;
    }
    if (policy.period.kind === "calendar") {
      policies.push({
        key: policy.key,
        kind: "calendar",
        action: policy.action,
        months: await ctx.settings.get(policy.period.settingKey),
        defaultMonths: CONTACT_RETENTION.defaultMonths,
        minimumMonths: CONTACT_RETENTION.minimumMonths,
      });
      continue;
    }
    const period: RetentionPeriod = RETENTION_PERIODS[policy.period.key];
    policies.push({
      key: policy.key,
      kind: "timed",
      action: policy.action,
      days: await ctx.settings.get(retentionSettingKey(policy.period.key)),
      defaultDays: period.defaultDays,
      minimumDays: minimumRetentionDays(period),
      hasFloor: period.floor !== undefined,
    });
  }
  for (const key of LIFECYCLE_POLICY_KEYS) {
    policies.push({ key, kind: "lifecycle" });
  }
  return policies;
}

export async function getInventory(
  ctx: InventoryContext
): Promise<InventoryView> {
  const { role } = await authorize(ctx, "privacy.inventory.view");
  return {
    entries: [...INVENTORY_VIEW_ENTRIES].sort(
      (a, b) =>
        a.table.localeCompare(b.table) || a.column.localeCompare(b.column)
    ),
    policies: await policyViews(ctx),
    enforced: await ctx.settings.get("retention.enforce"),
    canManageRetention: role === "super_admin",
  };
}
