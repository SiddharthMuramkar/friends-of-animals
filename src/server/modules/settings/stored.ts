// The deps' runtime settings (src/server/ports/settings.ts), read from the
// settings table: productionDeps(), the worker and the Seam 1 harness all
// build theirs here. A setting in the catalogue is read with readSetting
// on every call, so a super admin's change counts at once on every server
// instance and in the worker; a fixed one comes from `fixed`.
//
// Loads under plain Node (the worker): relative imports only, no
// "server-only".

import type { AppDb } from "../../db/app-db";
import {
  FIXED_SETTINGS,
  type FixedSettingKey,
  type FixedSettingValues,
  type Settings,
  type SettingValues,
} from "../../ports/settings";
import { isSettingKey } from "./catalogue";
import { readSetting } from "./read";

/**
 * Settings from `db`'s settings table. `fixed` holds the values that
 * aren't on the settings screen yet; only tests pass other values.
 */
export function storedSettings(
  db: AppDb,
  fixed: FixedSettingValues = FIXED_SETTINGS
): Settings {
  return {
    async get(key) {
      const value = isSettingKey(key)
        ? await readSetting(db, key)
        : fixed[key as FixedSettingKey];
      return value as SettingValues[typeof key];
    },
  };
}
