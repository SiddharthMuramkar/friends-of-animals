// The typed accessor: what app code calls to read a runtime setting. It
// reads the row on every call, with no cache, so a change counts at once
// on every server instance. Pass a transaction to read inside one. Loads
// under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import { setting } from "../db/schema";
import type { SettingKey, SettingValue } from "./catalogue";
import { resolveSetting } from "./values";

/**
 * The value that applies for `key` now: the stored one, or the default
 * while none is stored or the stored one no longer passes the schema.
 */
export async function readSetting<K extends SettingKey>(
  db: AppDb,
  key: K
): Promise<SettingValue<K>> {
  const [row] = await db
    .select({ value: setting.value })
    .from(setting)
    .where(eq(setting.key, key));
  return resolveSetting(key, row).value;
}
