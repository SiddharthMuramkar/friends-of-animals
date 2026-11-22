// Runtime settings: switches and values a super admin changes on the
// settings screen without a deploy, such as whether sign-in codes go by
// SMS. Use cases read them through `Settings` on the deps (or
// `readSetting(db, key)` inside a transaction) and never decide where they
// are stored. #62's settings table holds them, and its catalogue
// (src/server/modules/settings/catalogue.ts) is the one list of keys, with
// their types and defaults.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { SettingKey, SettingValue } from "../modules/settings/catalogue";

export type { SettingKey, SettingValue };

export interface Settings {
  /** The value that applies now: the stored one, or the default. */
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
}
