// The settings use cases (#62), for a super admin:
//
//   listSettings()  → every setting, its value, default and last change
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import { authorize } from "../access/can";
import { setting, user } from "../db/schema";
import type { UseCaseContext } from "../use-cases";
import { SETTINGS } from "./catalogue";
import type { SettingInput } from "./definition";
import { resolveAllSettings, type ResolvedSetting } from "./values";

/** What the settings use cases use: the database, the clock and the actor. */
export type SettingsContext = Pick<UseCaseContext, "db" | "clock" | "actor">;

/** One setting as the settings screen shows it. */
export type SettingView = ResolvedSetting & {
  input: SettingInput;
  /** When someone last stored a value; null while none is stored. */
  updatedAt: Date | null;
  /** Who stored it; null for seed data or once their account is gone. */
  updatedBy: { id: string; name: string } | null;
};

/** Every setting, in catalogue order. */
export async function listSettings(
  ctx: SettingsContext
): Promise<SettingView[]> {
  await authorize(ctx, "setting.view");
  const rows = await ctx.db
    .select({
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
      updatedById: user.id,
      updatedByName: user.name,
    })
    .from(setting)
    .leftJoin(user, eq(user.id, setting.updatedByUserId));
  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  return resolveAllSettings(rows).map((resolved) => {
    const row = byKey.get(resolved.key);
    return {
      ...resolved,
      input: SETTINGS[resolved.key].input,
      updatedAt: row?.updatedAt ?? null,
      updatedBy:
        row?.updatedById && row.updatedByName !== null
          ? { id: row.updatedById, name: row.updatedByName }
          : null,
    };
  });
}
