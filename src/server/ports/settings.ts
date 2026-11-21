// Runtime settings: switches and values staff can change without a
// deploy, such as whether sign-in codes go by SMS. Use cases read them
// through `Settings` on the deps and never decide where they are stored.
// The deps read #62's settings table (`storedSettings` in
// src/server/modules/settings), so what a super admin changes on
// /admin/settings applies to the next request and the next message, in
// the app and in the worker.
//
// Loads under plain Node: relative imports only, no "server-only".

import { CODE_REQUEST_LIMITS } from "../identity/settings";
import type {
  SettingKey as CatalogueKey,
  SettingValue as CatalogueValue,
} from "../modules/settings/catalogue";

/**
 * Values that aren't on the settings screen yet: every deployment reads
 * these. A ticket that adds one to the catalogue removes it here.
 */
export const FIXED_SETTINGS = {
  /** The most sign-in texts per hour, to everyone together. */
  "sms.maxPerHour": CODE_REQUEST_LIMITS.smsPerHour as number,
  /** The most sign-in texts per day (UTC), to everyone together. */
  "sms.maxPerDay": CODE_REQUEST_LIMITS.smsPerDay as number,
} as const;

export type FixedSettingKey = keyof typeof FIXED_SETTINGS;
export type FixedSettingValues = {
  -readonly [K in FixedSettingKey]: (typeof FIXED_SETTINGS)[K];
};

/** Every setting: the settings screen's, then the fixed ones. */
export type SettingKey = CatalogueKey | FixedSettingKey;
export type SettingValues = {
  [K in CatalogueKey]: CatalogueValue<K>;
} & FixedSettingValues;

export interface Settings {
  get<K extends SettingKey>(key: K): Promise<SettingValues[K]>;
}
