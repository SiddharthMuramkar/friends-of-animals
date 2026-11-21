// The settings module (#62): runtime settings a super admin changes
// without a deploy, and the typed accessor app code reads them through.

import type { AppDb } from "../db/app-db";
import type { SettingKey, SettingValue } from "./catalogue";

export type { SettingKey, SettingValue } from "./catalogue";

/** The value that applies for `key` now. */
export async function readSetting<K extends SettingKey>(
  _db: AppDb,
  _key: K
): Promise<SettingValue<K>> {
  throw new Error("readSetting is not built yet");
}
