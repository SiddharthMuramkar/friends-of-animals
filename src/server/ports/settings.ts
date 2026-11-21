// Runtime settings: switches and values staff can change without a
// deploy, such as whether sign-in codes go by SMS. Use cases read them
// through `Settings` on the deps and never decide where they are stored.
// #62 binds them to the settings table and its staff screen; until then
// each deployment reads fixed values (`fixedSettings`).
//
// Loads under plain Node: relative imports only, no "server-only".

import { CODE_REQUEST_LIMITS } from "../identity/settings";

/** Every setting, with the value it has until someone changes it. */
export const SETTING_DEFAULTS = {
  /**
   * Sign-in codes may go by SMS. Off until FOA's DLT sender ID and
   * templates are approved (HR-14); while off, codes come by email only.
   */
  "sms.enabled": false as boolean,
  /** The most sign-in texts per hour, to everyone together. */
  "sms.maxPerHour": CODE_REQUEST_LIMITS.smsPerHour as number,
  /** The most sign-in texts per day (UTC), to everyone together. */
  "sms.maxPerDay": CODE_REQUEST_LIMITS.smsPerDay as number,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValues = { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] };

export interface Settings {
  get<K extends SettingKey>(key: K): Promise<SettingValues[K]>;
}

/** Settings that never change: the defaults, with `values` over them. */
export function fixedSettings(values: Partial<SettingValues> = {}): Settings {
  const all: SettingValues = { ...SETTING_DEFAULTS, ...values };
  return { get: async (key) => all[key] };
}
