// Runtime settings: switches and values staff can change without a
// deploy, such as whether sign-in codes go by SMS. Use cases read them
// through `Settings` on the deps and never decide where they are stored.
// #62 binds them to the settings table and its staff screen; until then
// each deployment reads fixed values (`fixedSettings`).
//
// Loads under plain Node: relative imports only, no "server-only".

import type { Env } from "../../env.schema";
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

/**
 * The settings each deployment reads until #62's settings table holds
 * them; the app (src/server/deps.ts) and the VPS worker (src/worker) read
 * the same. Local runs and previews send SMS to the capture mailbox, so
 * sign-in by phone is on there (the Seam 2 journey uses it); staging and
 * production keep the default, off, until DLT approval (HR-14).
 */
export function settingsFor(appEnv: Env["APP_ENV"]): Settings {
  return appEnv === "local" || appEnv === "preview"
    ? fixedSettings({ "sms.enabled": true })
    : fixedSettings();
}
