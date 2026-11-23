// The typed accessor: what app code calls to read a runtime setting. It
// reads the row on every call, with no cache, so a change counts at once
// on every server instance. Pass a transaction to read inside one. Loads
// under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { setting } from "../../db/schema";
import type { Settings } from "../../ports/settings";
import type { SettingKey, SettingValue } from "./catalogue";
import { resolveSetting } from "./values";

/**
 * The value that applies for `key` now: the stored one, or the default
 * while none is stored or the stored one no longer passes the schema.
 * In a transaction, a shared lock holds the stored value through handoff.
 */
export async function readSetting<K extends SettingKey>(
  db: AppDb,
  key: K,
  options?: { lock: "share" }
): Promise<SettingValue<K>> {
  const query = db
    .select({ value: setting.value })
    .from(setting)
    .where(eq(setting.key, key));
  const [row] = await (options ? query.for(options.lock) : query);
  return resolveSetting(key, row).value;
}

/**
 * The deps' `Settings` over the settings table: every read goes to `db`,
 * so what a super admin saves applies on the next call.
 */
export function databaseSettings(db: AppDb): Settings {
  return { get: (key) => readSetting(db, key) };
}
